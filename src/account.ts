// Account resolution across three signing modes. Wraps host / extension /
// //Bob (dev) into a single ActiveAccount shape so the UI and deploy code
// don't need to branch on source.
//
// Per the polkadot-triangle skill's "host-first, standalone-fallback" rule:
// the app tries the Host API first (Polkadot Desktop / Mobile) and only
// surfaces the extension/dev paths to the user when host is unavailable.
//
// `signBytes` here is for arbitrary-data signing. When the chain-submission
// path lands we'll add a sibling `signer: PolkadotSigner` for use with
// `signSubmitAndWatch`.

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
    return {
        source: "host",
        address: account.address,
        displayName: account.name ?? truncateAddress(account.address),
        // The host SignerAccount exposes a different signer interface than
        // PAPI's PolkadotSigner. The actual chain-submit path will call
        // `signerManager.signRaw` (or the host's tx-signer equivalent)
        // rather than the bare PolkadotSigner — until that's wired we keep
        // a stub here that throws so a misuse fails loud.
        signer: stubHostSigner(),
    };
}

function stubHostSigner(): PolkadotSigner {
    const fail = (op: string): never => {
        throw new Error(
            `Host-signer ${op} is not wired yet. Use signerManager.signRaw(...) ` +
                `or the host's tx signer when chain submission lands.`,
        );
    };
    return {
        publicKey: new Uint8Array(),
        signBytes: () => Promise.reject(new Error("not wired")),
        signTx: () => fail("signTx"),
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
