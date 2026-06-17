// App-wide account session, shared by the homepage and the editor.
//
// account.ts has the per-source resolution (host / extension / dev); this is
// the single store that holds the CURRENT selection so every surface agrees on
// "who am I signed in as". Module-level + useSyncExternalStore, mirroring
// signer.ts — no context/prop-drilling, and the host boot runs exactly once.
//
// Precedence for the active account: an explicit dev toggle wins (it's a
// deliberate test choice), else the host account (Polkadot Desktop/Mobile),
// else a connected browser extension.

import { useSyncExternalStore } from "react";
import { truncateAddress } from "@parity/product-sdk-address";
import {
    getDevAccount,
    hasInjectedExtension,
    resolveHostAccount,
    tryExtensionAccount,
    type ActiveAccount,
} from "./account.ts";
import { getHostState, signInToHost, type HostStatus } from "./signer.ts";

export interface AccountSession {
    /** The account the app acts as, or null when signed out. */
    activeAccount: ActiveAccount | null;
    source: ActiveAccount["source"] | null;
    /** True while the initial host resolution is in flight (boot). */
    resolving: boolean;
    /** Host present but no Polkadot session — surface a "Sign in" CTA. */
    hostSignedOut: boolean;
    /** A browser-wallet extension is injected on this page. */
    hasExtension: boolean;
    /** The dev (//Bob) account is selected. */
    usingDev: boolean;
    error: string | null;
}

interface InternalState {
    host: ActiveAccount | null;
    extension: ActiveAccount | null;
    useDev: boolean;
    resolving: boolean;
    hostStatus: HostStatus;
    error: string | null;
}

let s: InternalState = {
    host: null,
    extension: null,
    useDev: false,
    resolving: true,
    hostStatus: "idle",
    error: null,
};

const listeners = new Set<() => void>();

// `//Bob` is deterministic and source-stable — derive once so the public
// snapshot keeps a stable identity (useSyncExternalStore loops otherwise).
let devAccount: ActiveAccount | null = null;
function dev(): ActiveAccount {
    return (devAccount ??= getDevAccount());
}

// Cached public snapshot: getSnapshot MUST return the same reference until
// state actually changes, so we rebuild it only inside `set`.
let snapshot: AccountSession;
function rebuild(): void {
    const active = s.useDev ? dev() : s.host ?? s.extension;
    snapshot = {
        activeAccount: active,
        source: active?.source ?? null,
        resolving: s.resolving,
        hostSignedOut: s.hostStatus === "signed-out",
        hasExtension: hasInjectedExtension(),
        usingDev: s.useDev,
        error: s.error,
    };
}
rebuild();

function set(patch: Partial<InternalState>): void {
    s = { ...s, ...patch };
    rebuild();
    for (const cb of listeners) cb();
}

function hostStateToAccount(): ActiveAccount | null {
    const state = getHostState();
    if (state.status !== "ready" || !state.account) return null;
    return {
        source: "host",
        address: state.account.address,
        displayName: state.account.displayName ?? truncateAddress(state.account.address),
        signer: state.account.signer,
    };
}

// ── Actions ─────────────────────────────────────────────────────────────────

let bootStarted = false;
/** Resolve the host account once, at app boot. Idempotent — safe to call from
 *  multiple mounts. In a plain browser this settles to null fast; inside a host
 *  it retries the async bridge (see resolveHostAccount). */
export async function ensureHostResolved(): Promise<void> {
    if (bootStarted) return;
    bootStarted = true;
    try {
        const account = await resolveHostAccount();
        set({ host: account, hostStatus: getHostState().status, resolving: false });
    } catch (cause) {
        set({ resolving: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
}

/** Open the host's sign-in UI, then adopt the resulting product account. */
export async function signInHost(): Promise<void> {
    set({ resolving: true, error: null });
    try {
        const state = await signInToHost();
        set({
            host: hostStateToAccount(),
            hostStatus: state.status,
            resolving: false,
            useDev: false,
        });
    } catch (cause) {
        set({ resolving: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
}

/** Connect the first injected browser-wallet extension and adopt its account. */
export async function connectExtension(): Promise<void> {
    set({ error: null });
    try {
        const account = await tryExtensionAccount();
        if (account) set({ extension: account, useDev: false });
        else set({ error: "No account found in your wallet — create one and try again." });
    } catch (cause) {
        set({ error: cause instanceof Error ? cause.message : String(cause) });
    }
}

/** Toggle the dev (//Bob) account on/off. */
export function setUseDev(on: boolean): void {
    set({ useDev: on, error: null });
}

/** Drop the local selection (extension / dev). The host session is ambient —
 *  it re-resolves on reload — so this reverts to the host account if present,
 *  otherwise to signed-out. */
export function disconnect(): void {
    set({ extension: null, useDev: false });
}

export function getAccountSession(): AccountSession {
    return snapshot;
}

export function useAccountSession(): AccountSession {
    return useSyncExternalStore(
        (cb) => {
            listeners.add(cb);
            return () => {
                listeners.delete(cb);
            };
        },
        () => snapshot,
        () => snapshot,
    );
}
