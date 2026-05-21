import { useEffect, useMemo, useState } from "react";
import { Editor } from "./Editor.tsx";
import { Preview } from "./Preview.tsx";
import { DEFAULT_CONTENT, renderHtml, type SiteContent } from "./template.ts";
import {
    deployFull,
    previewDeploy,
    type DeployPreview,
    type DeploySuccess,
} from "./deploy.ts";
import {
    type ActiveAccount,
    getDevAccount,
    hasInjectedExtension,
    tryExtensionAccount,
    tryHostAccount,
} from "./account.ts";

type DeployResult = DeployPreview | DeploySuccess;

export default function App() {
    const [content, setContent] = useState<SiteContent>(DEFAULT_CONTENT);
    const [domain, setDomain] = useState("");
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [result, setResult] = useState<DeployResult | null>(null);
    const [deployError, setDeployError] = useState<string | null>(null);

    // //Bob is the default. Users opt INTO their own account; the auto-host
    // probe doesn't run until they ask for it, which keeps the standalone
    // browser case quiet.
    const [useOwnedAccount, setUseOwnedAccount] = useState(false);
    const [hostAccount, setHostAccount] = useState<ActiveAccount | null>(null);
    const [extensionAccount, setExtensionAccount] = useState<ActiveAccount | null>(null);
    const [resolvingOwned, setResolvingOwned] = useState(false);
    const [ownedError, setOwnedError] = useState<string | null>(null);

    const devAccount = useMemo(() => getDevAccount(), []);
    const activeAccount: ActiveAccount | null = useOwnedAccount
        ? extensionAccount ?? hostAccount
        : devAccount;

    // When the user toggles ON "sign with my own account", try the host signer
    // (Polkadot Desktop / Mobile) once. If host fails, the "Connect browser
    // wallet" button below offers the standalone fallback. Toggling OFF
    // doesn't tear down the resolved account — the dev path simply ignores it.
    useEffect(() => {
        if (!useOwnedAccount || hostAccount || extensionAccount) return;
        setResolvingOwned(true);
        setOwnedError(null);
        tryHostAccount()
            .then((account) => {
                if (account) setHostAccount(account);
            })
            .catch((cause) => {
                setOwnedError(cause instanceof Error ? cause.message : String(cause));
            })
            .finally(() => setResolvingOwned(false));
    }, [useOwnedAccount, hostAccount, extensionAccount]);

    const connectExtension = async () => {
        setOwnedError(null);
        try {
            const account = await tryExtensionAccount();
            if (account) {
                setExtensionAccount(account);
            } else {
                setOwnedError(
                    "No browser wallet found. Install Talisman, SubWallet, or Polkadot.js — or untick the box to deploy as //Bob.",
                );
            }
        } catch (cause) {
            setOwnedError(cause instanceof Error ? cause.message : String(cause));
        }
    };

    const deploy = async () => {
        setBusy(true);
        setResult(null);
        setDeployError(null);
        setStatus(null);
        try {
            const html = renderHtml(content);
            if (activeAccount?.source === "dev") {
                const stored = await deployFull(html, domain || null, activeAccount, setStatus);
                setResult(stored);
            } else {
                const preview = await previewDeploy(html, domain || null);
                setResult(preview);
            }
        } catch (cause) {
            setDeployError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setBusy(false);
            setStatus(null);
        }
    };

    // The Deploy button stays enabled when Bob is selected (always available)
    // OR when the user has actually resolved an owned account. Going through
    // "owned mode" without a signer would deploy nothing.
    const canDeploy = !busy && activeAccount !== null;
    const showOwnedHint =
        useOwnedAccount && !hostAccount && !extensionAccount && !resolvingOwned;

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
                        {resolvingOwned ? "connecting…" : "no signer"}
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
                            disabled={!canDeploy}
                        >
                            {busy ? "Deploying…" : "Deploy"}
                        </button>
                    </div>

                    <div className="signer-bar">
                        <label className="checkbox">
                            <input
                                type="checkbox"
                                checked={useOwnedAccount}
                                onChange={(e) => setUseOwnedAccount(e.target.checked)}
                            />
                            <span>
                                Sign with my own account
                                <span className="checkbox-hint">
                                    {" "}— default is //Bob (shared testnet)
                                </span>
                            </span>
                        </label>
                        {useOwnedAccount && !hostAccount && !extensionAccount && (
                            <button
                                className="btn btn-secondary"
                                onClick={connectExtension}
                                disabled={!hasInjectedExtension() || resolvingOwned}
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

                    {busy && status && <p className="status">{status}</p>}

                    {showOwnedHint && (
                        <p className="hint">
                            No host signer detected. Open this app in{" "}
                            <strong>Polkadot Desktop</strong> or{" "}
                            <strong>Polkadot Mobile</strong> to sign with your account, or
                            click <strong>Connect browser wallet</strong>. Untick the box to
                            deploy as //Bob (no setup needed).
                        </p>
                    )}
                    {ownedError && <p className="hint subtle">{ownedError}</p>}

                    {result && <ResultCard result={result} account={activeAccount} />}
                    {deployError && <pre className="error error-block">{deployError}</pre>}
                </section>

                <section className="pane preview-pane">
                    <Preview content={content} />
                </section>
            </main>
        </>
    );
}

function ResultCard({
    result,
    account,
}: {
    result: DeployResult;
    account: ActiveAccount | null;
}) {
    return (
        <div className={`result result-${result.kind}`}>
            <Row label="bytes">{result.bytes.toLocaleString()} B</Row>
            <Row label="CID" mono>
                {result.cid}
            </Row>
            <Row label="gateway">
                <a href={result.gatewayUrl} target="_blank" rel="noopener">
                    {result.gatewayUrl}
                </a>
            </Row>
            <Row label="would resolve to">
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
                {account ? `${account.displayName} (${account.source})` : "— no signer —"}
            </Row>
            {result.kind === "stored" ? (
                <>
                    <Row label="block">#{result.blockNumber.toLocaleString()}</Row>
                    {result.dotMapped ? (
                        <p className="result-note success">
                            Live on{" "}
                            <a href={result.url} target="_blank" rel="noopener">
                                {result.url}
                            </a>
                            . The <code>.dot</code> name is registered to your account and
                            points at the Bulletin-stored content. Resolution may take a few
                            seconds to propagate.
                        </p>
                    ) : (
                        <p className="result-note">
                            Stored on Bulletin Chain ✓. The <code>.dot.li</code> mapping
                            step failed — see the status banner above for the reason. The
                            bytes are still retrievable via the gateway link.
                        </p>
                    )}
                </>
            ) : (
                <p className="result-note">
                    Preview only — chain submission for {account?.source ?? "this signer"}{" "}
                    is not wired. Untick "Sign with my own account" to do an end-to-end
                    deploy as //Bob.
                </p>
            )}
        </div>
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
