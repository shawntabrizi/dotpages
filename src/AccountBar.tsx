// The login / account widget shared by the homepage and the editor. Reads the
// app-wide session (accountSession.ts) so every surface shows the same account.
//
// Works across all three environments: inside a Polkadot host it auto-connects
// (and offers "Sign in to Polkadot" when the host has no session); in a plain
// browser it connects a wallet extension; with no wallet it points the user at
// one and offers the dev account for local testing.

import { useEffect, useRef, useState } from "react";
import { truncateAddress } from "@parity/product-sdk-address";
import {
    connectExtension,
    disconnect,
    setUseDev,
    signInHost,
    useAccountSession,
} from "./accountSession.ts";

// pjs-signer drives extension support, so point at the canonical Polkadot{.js}
// extension; any SubWallet/Talisman install also satisfies the injected check.
const WALLET_URL = "https://polkadot.js.org/extension/";

const SOURCE_LABEL: Record<string, string> = {
    host: "Polkadot",
    extension: "Wallet",
    dev: "Dev account",
};

export default function AccountBar() {
    const { activeAccount, source, resolving, hostSignedOut, hasExtension, usingDev, error } =
        useAccountSession();
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close the menu on an outside click / Escape.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    const run = async (fn: () => Promise<void>) => {
        setBusy(true);
        try {
            await fn();
        } finally {
            setBusy(false);
        }
    };

    const triggerLabel = activeAccount
        ? activeAccount.displayName
        : resolving
          ? "Connecting…"
          : "Sign in";

    return (
        <div className="account-bar" ref={ref}>
            <button
                type="button"
                className="account-trigger"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
                disabled={resolving && !activeAccount}
            >
                <span className={`source-dot source-${source ?? "none"}`} aria-hidden="true" />
                <span className="account-trigger-name">{triggerLabel}</span>
                <span className="account-caret" aria-hidden="true">
                    ▾
                </span>
            </button>

            {open && (
                <div className="account-menu" role="menu">
                    {activeAccount ? (
                        <>
                            <div className="account-menu-head">
                                <span
                                    className={`source-dot source-${source ?? "none"}`}
                                    aria-hidden="true"
                                />
                                <div className="account-menu-id">
                                    <div className="account-menu-name">
                                        {activeAccount.displayName}
                                    </div>
                                    <div className="account-menu-meta">
                                        {SOURCE_LABEL[source ?? ""] ?? "Account"} ·{" "}
                                        {truncateAddress(activeAccount.address)}
                                    </div>
                                </div>
                            </div>
                            {hasExtension && source !== "extension" && (
                                <button
                                    type="button"
                                    className="account-menu-action"
                                    disabled={busy}
                                    onClick={() => run(connectExtension)}
                                >
                                    Switch to wallet
                                </button>
                            )}
                            <button
                                type="button"
                                className="account-menu-action"
                                onClick={() => {
                                    disconnect();
                                    setOpen(false);
                                }}
                            >
                                Sign out
                            </button>
                        </>
                    ) : (
                        <>
                            {hostSignedOut && (
                                <button
                                    type="button"
                                    className="account-menu-action is-primary"
                                    disabled={busy}
                                    onClick={() => run(signInHost)}
                                >
                                    Sign in to Polkadot
                                </button>
                            )}
                            {hasExtension && (
                                <button
                                    type="button"
                                    className="account-menu-action is-primary"
                                    disabled={busy}
                                    onClick={() => run(connectExtension)}
                                >
                                    Connect wallet
                                </button>
                            )}
                            {!hasExtension && !hostSignedOut && (
                                <div className="account-menu-empty">
                                    No Polkadot wallet found.{" "}
                                    <a href={WALLET_URL} target="_blank" rel="noopener">
                                        Get a wallet ↗
                                    </a>
                                </div>
                            )}
                        </>
                    )}

                    {/* Dev account: a subtle local-testing fallback, available in
                        every state. */}
                    <label className="account-dev-toggle">
                        <input
                            type="checkbox"
                            checked={usingDev}
                            onChange={(e) => setUseDev(e.target.checked)}
                        />
                        <span>Use dev account</span>
                    </label>

                    {error && <div className="account-menu-error">{error}</div>}
                </div>
            )}
        </div>
    );
}
