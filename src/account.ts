// Account resolution across three signing modes. Wraps host / extension /
// //Bob (dev) into a single ActiveAccount shape so the UI and deploy code
// don't need to branch on source.
//
// Per the polkadot-triangle skill's "host-first, standalone-fallback" rule:
// the app tries the Host API first (Polkadot Desktop / Mobile) and only
// surfaces the extension/dev paths to the user when host is unavailable.
//
// `signer` is the underlying PAPI signer used by the deploy flow's
// `signSubmitAndWatch` calls. The host path now resolves a real signer from
// the SignerManager (see `tryHostAccount`), so all three sources submit chain
// transactions through the same `PolkadotSigner` shape.

import { ss58Encode, truncateAddress } from "@parity/product-sdk-address";
import { createDevSigner, getDevPublicKey } from "@parity/product-sdk-tx";
import { connectInjectedExtension, getInjectedExtensions } from "polkadot-api/pjs-signer";
import type { PolkadotSigner } from "polkadot-api";
import { signerManager } from "./signer.ts";

export type AccountSource = "host" | "extension" | "dev";

export interface ActiveAccount {
    source: AccountSource;
    address: string;
    displayName: string;
    /** Underlying PAPI signer — used by the deploy flow once chain calls land. */
    signer: PolkadotSigner;
}

const DEV_ACCOUNT_NAME = "Bob";

// The currently-active account, mirrored at module scope so non-React code
// (the CloudStorageClient's lazy signer in lib/bulletin/store.ts) can read the
// signer of whichever source — host / extension / dev — the user has selected.
// App owns the authoritative state and pushes changes here via
// `setCurrentAccount` whenever the active account changes.
let currentAccount: ActiveAccount | null = null;

export function setCurrentAccount(account: ActiveAccount | null): void {
    currentAccount = account;
}

export function getCurrentAccount(): ActiveAccount | null {
    return currentAccount;
}

/**
 * Synchronous — `//Bob` requires no network, just a deterministic derivation.
 * The toggleable dev fallback in the UI.
 */
export function getDevAccount(): ActiveAccount {
    return {
        source: "dev",
        address: ss58Encode(getDevPublicKey(DEV_ACCOUNT_NAME)),
        displayName: `${DEV_ACCOUNT_NAME} (dev)`,
        signer: createDevSigner(DEV_ACCOUNT_NAME),
    };
}

/**
 * Resolve the Host API account (Polkadot Desktop / Mobile). Returns null if
 * the host isn't available — the signer wrapper transitions to `disconnected`
 * in that case.
 */
export async function tryHostAccount(): Promise<ActiveAccount | null> {
    const result = await signerManager.connect();
    if (!result.ok) return null;
    const state = signerManager.getState();
    const account = state.selectedAccount;
    if (!account) return null;
    // After a successful connect the SignerManager has a selected account, so
    // its signer must be available. A null here means the host returned a
    // connected-but-signerless state — surface it loudly rather than handing
    // back a stub that would fail deep inside the deploy flow.
    const signer = signerManager.getSigner();
    if (!signer) {
        throw new Error("Host connected but no signer is available for the selected account");
    }
    return {
        source: "host",
        address: account.address,
        displayName: account.name ?? truncateAddress(account.address),
        signer,
    };
}

/** Discover whether any browser-wallet extension is injected on this page. */
export function hasInjectedExtension(): boolean {
    try {
        return getInjectedExtensions().length > 0;
    } catch {
        return false;
    }
}

/**
 * Connect to the first available injected extension (Talisman, Polkadot.js,
 * SubWallet, etc.) and pick its first account. A future UI iteration can let
 * the user pick a specific extension and account.
 */
export async function tryExtensionAccount(): Promise<ActiveAccount | null> {
    const names = getInjectedExtensions();
    if (names.length === 0) return null;

    const extension = await connectInjectedExtension(names[0], "hello-playground");
    const accounts = extension.getAccounts();
    if (accounts.length === 0) return null;

    const account = accounts[0];
    return {
        source: "extension",
        address: account.address,
        displayName: account.name ?? truncateAddress(account.address),
        signer: account.polkadotSigner,
    };
}
