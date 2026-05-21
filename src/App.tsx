import { useEffect, useState } from "react";
import { truncateAddress } from "@parity/product-sdk-address";
import { Editor } from "./Editor.tsx";
import { Preview } from "./Preview.tsx";
import { DEFAULT_CONTENT, renderHtml, type SiteContent } from "./template.ts";
import { previewDeploy, type DeployPreview } from "./deploy.ts";
import { signerManager, useSignerState } from "./signer.ts";

export default function App() {
    const { selectedAccount, status, error } = useSignerState();
    const [content, setContent] = useState<SiteContent>(DEFAULT_CONTENT);
    const [domain, setDomain] = useState("");
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<DeployPreview | null>(null);
    const [deployError, setDeployError] = useState<string | null>(null);

    useEffect(() => {
        signerManager.connect().then((res) => {
            if (res.ok && res.value.length > 0) {
                signerManager.selectAccount(res.value[0].address);
            }
        });
    }, []);

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

    return (
        <>
            <header>
                <h1>hello-playground</h1>
                {selectedAccount ? (
                    <span className="address-chip">
                        {selectedAccount.name ?? truncateAddress(selectedAccount.address)}
                    </span>
                ) : (
                    <span className="status-chip">{status}</span>
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

                    {!selectedAccount && status !== "connecting" && (
                        <p className="hint">
                            {error?.message ?? (
                                <>
                                    Open in <strong>Polkadot Desktop</strong> or{" "}
                                    <strong>Polkadot Mobile</strong> to sign and deploy.
                                </>
                            )}
                        </p>
                    )}

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
