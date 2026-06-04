// Host-API signer wrapper. Adapted from playground-app-template's utils.ts,
// trimmed to what hello-playground actually needs: a connected product-account
// signer and the BulletInAllowance resource grant (for the eventual
// TransactionStorage.store call). DotNS-allowance handling will live here too
// once the deploy path is fully wired.

import { useSyncExternalStore } from "react";
import { AllocatableResource, AllocationOutcome, type CodecType } from "@novasamatech/host-api";
import {
    AccountNotFoundError,
    SignerManager,
    SigningFailedError,
    err,
    ok,
    type ConnectContext,
    type Result,
    type SignerAccount,
    type SignerError,
    type SignerState,
} from "@parity/product-sdk-signer";

const DEFAULT_PRODUCT_ACCOUNT_DOT_NS = "hello-playground.dot";
const PRODUCT_ACCOUNT_DERIVATION_INDEX = 0;

// What we ask the host to grant us. BulletInAllowance is the one that matters
// for `TransactionStorage.store` — without it our store calls fail silently.
// SmartContractAllowance is included for the future DotNS register/setContent
// path (pallet-revive). The others are kept aligned with the template so a
// single consent dialog covers everything.
const RESOURCE_ALLOCATION_REQUESTS = [
    { tag: "StatementStoreAllowance", value: undefined },
    { tag: "BulletInAllowance", value: undefined },
    { tag: "SmartContractAllowance", value: PRODUCT_ACCOUNT_DERIVATION_INDEX },
    { tag: "AutoSigning", value: undefined },
] as const satisfies ReadonlyArray<CodecType<typeof AllocatableResource>>;

export type ResourceAllocationKind = CodecType<typeof AllocatableResource>["tag"];
export type ResourceAllocationOutcome = CodecType<typeof AllocationOutcome>["tag"];

export interface ResourceAllocationEntry {
    resource: ResourceAllocationKind;
    outcome: ResourceAllocationOutcome | null;
}

export interface ResourceAllocationState {
    status: "idle" | "requesting" | "complete" | "unavailable" | "error";
    entries: readonly ResourceAllocationEntry[];
    error: string | null;
}

const INITIAL_RESOURCE_ENTRIES: readonly ResourceAllocationEntry[] =
    RESOURCE_ALLOCATION_REQUESTS.map((request) => ({ resource: request.tag, outcome: null }));

function isLoopback(hostname: string): boolean {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function getProductAccountIdentifier(): string {
    const configured = import.meta.env.VITE_PRODUCT_ACCOUNT_ID?.trim();
    if (configured) return configured;

    const { host, hostname } = window.location;
    if (isLoopback(hostname)) return host;

    // dotli exposes hosted products as `<name>.<gateway>` (e.g.
    // `hello-playground.dot.li`). Map back to the canonical `<name>.dot`
    // identifier the host signs against.
    const labels = hostname.toLowerCase().split(".");
    if (labels.length === 3) return `${labels[0]}.dot`;

    if (hostname.endsWith(".dot")) return hostname;
    return DEFAULT_PRODUCT_ACCOUNT_DOT_NS;
}

function initialSignerState(): SignerState {
    return {
        status: "disconnected",
        accounts: [],
        selectedAccount: null,
        activeProvider: null,
        error: null,
    };
}

function initialResourceState(): ResourceAllocationState {
    return { status: "idle", entries: INITIAL_RESOURCE_ENTRIES, error: null };
}

class ProductAccountSignerManager {
    readonly productAccountIdentifier = getProductAccountIdentifier();
    private readonly manager = new SignerManager({
        dappName: this.productAccountIdentifier,
        ss58Prefix: 42,
        // Fires once per transition into "connected" (and again after an
        // auto-reconnect) — the SDK-sanctioned place to request resource
        // grants. Replaces the old getTruApi().requestResourceAllocation
        // call we made manually after connect.
        onConnect: (_account, ctx) => this.runResourceAllocation(ctx),
    });
    private readonly signerSubs = new Set<(state: SignerState) => void>();
    private readonly resourceSubs = new Set<(state: ResourceAllocationState) => void>();
    private state = initialSignerState();
    private resourceState = initialResourceState();
    private connectPromise: Promise<Result<SignerAccount[], SignerError>> | null = null;

    constructor() {
        this.manager.subscribe((underlying) => {
            if (underlying.status === "disconnected" && this.state.status !== "disconnected") {
                this.transitionToDisconnected(underlying.error);
            }
        });
    }

    private transitionToDisconnected(error: SignerError | null) {
        this.setState({
            status: "disconnected",
            accounts: [],
            selectedAccount: null,
            activeProvider: null,
            error,
        });
        this.setResourceState(initialResourceState());
    }

    getState(): SignerState {
        return this.state;
    }
    getResourceAllocationState(): ResourceAllocationState {
        return this.resourceState;
    }

    subscribe(cb: (state: SignerState) => void): () => void {
        this.signerSubs.add(cb);
        return () => {
            this.signerSubs.delete(cb);
        };
    }

    subscribeResourceAllocation(cb: (state: ResourceAllocationState) => void): () => void {
        this.resourceSubs.add(cb);
        return () => {
            this.resourceSubs.delete(cb);
        };
    }

    async connect(): Promise<Result<SignerAccount[], SignerError>> {
        if (this.state.status === "connected") return ok([...this.state.accounts]);
        if (this.connectPromise) return this.connectPromise;
        this.connectPromise = this.connectInner().finally(() => {
            this.connectPromise = null;
        });
        return this.connectPromise;
    }

    private async connectInner(): Promise<Result<SignerAccount[], SignerError>> {
        this.setState({
            status: "connecting",
            accounts: [],
            selectedAccount: null,
            activeProvider: "host",
            error: null,
        });

        const connection = await this.manager.connect("host");
        if (!connection.ok) {
            this.transitionToDisconnected(connection.error);
            return connection;
        }
        const ownerName = connection.value[0]?.name ?? null;

        const productAccount = await this.manager.getProductAccount(
            this.productAccountIdentifier,
            PRODUCT_ACCOUNT_DERIVATION_INDEX,
        );
        if (!productAccount.ok) {
            this.transitionToDisconnected(productAccount.error);
            this.manager.disconnect();
            return err(productAccount.error);
        }

        const selected: SignerAccount = {
            ...productAccount.value,
            name: productAccount.value.name ?? ownerName,
        };
        this.setState({
            status: "connected",
            accounts: [selected],
            selectedAccount: selected,
            activeProvider: "host",
            error: null,
        });
        // Resource allocation runs via the SignerManager onConnect callback.
        return ok([selected]);
    }

    private async runResourceAllocation(ctx: ConnectContext): Promise<void> {
        this.setResourceState({
            status: "requesting",
            entries: INITIAL_RESOURCE_ENTRIES,
            error: null,
        });
        try {
            const outcomes = await ctx.requestResourceAllocation([
                ...RESOURCE_ALLOCATION_REQUESTS,
            ]);
            if (ctx.signal.aborted) return;
            this.setResourceState({
                status: "complete",
                entries: RESOURCE_ALLOCATION_REQUESTS.map((request, i) => ({
                    resource: request.tag,
                    outcome: outcomes[i]?.tag ?? "NotAvailable",
                })),
                error: null,
            });
        } catch (cause) {
            if (ctx.signal.aborted) return;
            this.setResourceState({
                status: "error",
                entries: INITIAL_RESOURCE_ENTRIES,
                error: cause instanceof Error ? cause.message : String(cause),
            });
        }
    }

    selectAccount(address: string): Result<SignerAccount, SignerError> {
        const account = this.state.accounts.find((a) => a.address === address);
        if (!account) return err(new AccountNotFoundError(address));
        this.setState({ selectedAccount: account });
        return ok(account);
    }

    getSigner(): ReturnType<SignerAccount["getSigner"]> | null {
        return this.state.selectedAccount?.getSigner() ?? null;
    }

    async signRaw(data: Uint8Array): Promise<Result<Uint8Array, SignerError>> {
        const signer = this.getSigner();
        if (!signer) return err(new SigningFailedError(null, "No product account selected"));
        try {
            return ok(await signer.signBytes(data));
        } catch (cause) {
            return err(new SigningFailedError(cause));
        }
    }

    private setState(patch: Partial<SignerState>) {
        this.state = { ...this.state, ...patch };
        for (const sub of this.signerSubs) sub(this.state);
    }

    private setResourceState(state: ResourceAllocationState) {
        this.resourceState = state;
        for (const sub of this.resourceSubs) sub(this.resourceState);
    }
}

export type { SignerAccount, SignerState };

export const signerManager = new ProductAccountSignerManager();

export function useSignerState(): SignerState {
    return useSyncExternalStore(
        (cb) => signerManager.subscribe(cb),
        () => signerManager.getState(),
    );
}

export function useResourceAllocationState(): ResourceAllocationState {
    return useSyncExternalStore(
        (cb) => signerManager.subscribeResourceAllocation(cb),
        () => signerManager.getResourceAllocationState(),
    );
}
