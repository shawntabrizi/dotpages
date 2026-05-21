import { useEffect, useMemo, useState } from "react";
import { Editor } from "./Editor.tsx";
import { Preview } from "./Preview.tsx";
import { DEFAULT_CONTENT, renderHtml, type SiteContent } from "./template.ts";
import { previewDeploy, type DeployPreview } from "./deploy.ts";
import {
    type ActiveAccount,
    getDevAccount,
    hasInjectedExtension,
    tryExtensionAccount,
    tryHostAccount,
} from "./account.ts";

export default function App() {
    const [content, setContent] = useState<SiteContent>(DEFAULT_CONTENT);
    const [domain, setDomain] = useState("");
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<DeployPreview | null>(null);
    const [deployError, setDeployError] = useState<string | null>(null);

    // Account state. Three independent slots — `useDev` always wins, otherwise
    // extension > host. This way toggling the dev checkbox doesn't tear down
    // a live host/extension connection.
    const [useDev, setUseDev] = useState(false);
    const [hostAccount, setHostAccount] = useState<ActiveAccount | null>(null);
    const [extensionAccount, setExtensionAccount] = useState<ActiveAccount | null>(null);
    const [hostAttempted, setHostAttempted] = useState(false);
    const [hostError, setHostError] = useState<string | null>(null);
    const [extensionError, setExtensionError] = useState<string | null>(null);

    const devAccount = useMemo(() => getDevAccount(), []);
    const activeAccount: ActiveAccount | null = useDev
        ? devAccount
        : extensionAccount ?? hostAccount;

    useEffect(() => {
        tryHostAccount()
            .then((account) => {
                if (account) setHostAccount(account);
            })
            .catch((cause) => {
                setHostError(cause instanceof Error ? cause.message : String(cause));
            })
            .finally(() => setHostAttempted(true));
    }, []);

    const connectExtension = async () => {
        setExtensionError(null);
        try {
            const account = await tryExtensionAccount();
            if (account) {
                setExtensionAccount(account);
            } else {
                setExtensionError(
                    "No browser wallet found. Install Talisman, SubWallet, or Polkadot.js — or check the //Bob box below.",
                );
            }
        } catch (cause) {
            setExtensionError(cause instanceof Error ? cause.message : String(cause));
        }
    };

    const deploy = async () => {
        setBusy(true);
        setResult(null);
        setDeployError(null);
        try {
            const preview = await previewDeploy(renderHtml(content), domain || null);
            setResult(preview);
        } catch (cause) {
            setDeployError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setBusy(false);
        }
    };

    // We surface the host-failed hint only when host attempted, no other
    // signer is active, and dev isn't toggled — to avoid noise once the user
    // has picked an alternative.
    const showStandaloneHints =
        hostAttempted && !hostAccount && !extensionAccount && !useDev;

    return (
        <>
            <header>
                <h1>hello-playground</h1>
                {activeAccount ? (
                    <span className={`address-chip source-${activeAccount.source}`}>
                        {activeAccount.displayName}
                    </span>
                ) : (
                    <span className="status-chip">
                        {hostAttempted ? "no signer" : "connecting…"}
                    </span>
                )}
            </header>

            <main>
                <section className="pane editor-pane">
                    <Editor value={content} onChange={setContent} />

                    <div className="deploy-bar">
                        <label className="field">
                            <span className="field-label">.dot name</span>
                            <input
                                type="text"
                                placeholder="auto-generated if blank"
                                value={domain}
                                onChange={(e) => setDomain(e.target.value.trim())}
                            />
                        </label>
                        <button
                            className="btn btn-primary"
                            onClick={deploy}
                            disabled={busy}
                        >
                            {busy ? "Deploying…" : "Deploy"}
                        </button>
                    </div>

                    <div className="signer-bar">
                        <label className="checkbox">
                            <input
                                type="checkbox"
                                checked={useDev}
                                onChange={(e) => setUseDev(e.target.checked)}
                            />
                            <span>Use //Bob — shared test account, no wallet needed</span>
                        </label>
                        {!useDev && !extensionAccount && hostAttempted && (
                            <button
                                className="btn btn-secondary"
                                onClick={connectExtension}
                                disabled={!hasInjectedExtension()}
                                title={
                                    hasInjectedExtension()
                                        ? "Connect Talisman, SubWallet, or Polkadot.js"
                                        : "No browser wallet detected"
                                }
                            >
                                Connect browser wallet
                            </button>
                        )}
                    </div>

                    {showStandaloneHints && (
                        <p className="hint">
                            Host signer not available — open in{" "}
                            <strong>Polkadot Desktop</strong> or{" "}
                            <strong>Polkadot Mobile</strong> to sign with your account,
                            connect a browser wallet, or tick the //Bob box to deploy
                            under a shared test account.
                        </p>
                    )}
                    {hostError && !hostAccount && (
                        <p className="hint subtle">Host: {hostError}</p>
                    )}
                    {extensionError && <p className="error">{extensionError}</p>}

                    {result && (
                        <div className="result">
                            <Row label="bytes">{result.bytes.toLocaleString()} B</Row>
                            <Row label="CID" mono>
                                {result.cid}
                            </Row>
                            <Row label="would deploy to">
                                <a
                                    href={result.url}
                                    target="_blank"
                                    rel="noopener"
                                    onClick={(e) => e.preventDefault()}
                                >
                                    {result.url}
                                </a>
                            </Row>
                            <Row label="signed by">
                                {activeAccount
                                    ? `${activeAccount.displayName} (${activeAccount.source})`
                                    : "— no signer selected —"}
                            </Row>
                            <p className="result-note">
                                Chain submission is not yet wired — see <code>src/deploy.ts</code>.
                            </p>
                        </div>
                    )}
                    {deployError && <p className="error">{deployError}</p>}
                </section>

                <section className="pane preview-pane">
                    <Preview content={content} />
                </section>
            </main>
        </>
    );
}

function Row({
    label,
    children,
    mono,
}: {
    label: string;
    children: React.ReactNode;
    mono?: boolean;
}) {
    return (
        <div className="row-line">
            <span className="row-label">{label}</span>
            <span className={`row-value${mono ? " mono" : ""}`}>{children}</span>
        </div>
    );
}
