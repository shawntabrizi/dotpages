// Landing page — the launcher the app opens to. The Instagram shape:
// launcher -> picker -> editor. Picking a template implies blocks mode
// (templates build SiteContent); Markdown and HTML start blank in their
// respective modes. Every start mints a fresh draft slot — existing drafts are
// never replaced, only explicitly deleted (capped at MAX_DRAFTS, blocked with
// a message).
//
// Ported from playground-app/src/builder/Landing.tsx, minus the playground-only
// onboarding gate (BecomeBuilderCard / useOnboarding) and the host-nav PopupLink
// (standalone links open in a new tab).

import { useMemo, type ReactNode } from "react";
import { PopupLink } from "./LinkPopup.tsx";
import { TEMPLATES } from "./templates.ts";
import { renderHtml } from "./template.ts";
import { iframesAllowed } from "./iframes.ts";
import { loadDeployedSites } from "./deployed.ts";
import {
    draftHtml,
    draftTitle,
    newDraftId,
    MAX_DRAFTS,
    MODE_NAMES,
    type BuilderEntry,
    type DraftRecord,
} from "./draft.ts";

// Decorative source previews for the write-it-yourself cards (aria-hidden;
// the real copy lives in the card name/desc). Lines mirror what the blank
// starters actually open with.
const MD_SNIPPET = (
    <>
        <span className="builder-code-k"># Hello, world</span>
        <span>&nbsp;</span>
        <span>This is your page. Click</span>
        <span>anything to make it yours.</span>
        <span>&nbsp;</span>
        <span>
            <span className="builder-code-k">**Bold**</span>, lists, [links] —
        </span>
    </>
);
const HTML_SNIPPET = (
    <>
        <span>
            <span className="builder-code-k">&lt;h1&gt;</span>Hello, world
            <span className="builder-code-k">&lt;/h1&gt;</span>
        </span>
        <span>
            <span className="builder-code-k">&lt;button&gt;</span>Click me
            <span className="builder-code-k">&lt;/button&gt;</span>
        </span>
        <span>&nbsp;</span>
        <span>{"h1 { color: "}<span className="builder-code-k">#e6007a</span>{"; }"}</span>
        <span>{'button.addEventListener("click", …)'}</span>
    </>
);

// Coarse relative time for draft cards — drafts are touched on the scale of
// minutes-to-days, so anything finer is noise.
function timeAgo(ts: number): string {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
}

// One starting-point card. div + stretched button, not a plain <button>: an
// iframe is interactive content and can't nest inside a button. The thumbnail
// iframe is fully sandboxed (no scripts) — pixels only.
interface Thumb {
    html: string;
    /** Site accent for the no-iframe fallback strip (Polkadot Mobile's
     *  webview forbids iframe creation — see iframes.ts). */
    accent: string;
}

function StartCard({
    thumb,
    htmlKey,
    snippet,
    name,
    desc,
    onClick,
    onDelete,
    disabled,
    modifier,
    testid,
}: {
    /** Rendered document + theme for the thumbnail; omit for text-only cards. */
    thumb?: Thumb;
    /** Remounts the thumbnail iframe when it changes. Browsers differ on
     *  whether updating srcdoc re-navigates an EXISTING iframe — a fresh
     *  element always loads. Key draft cards on their updatedAt. */
    htmlKey?: string;
    /** Source-flavored thumbnail (code lines) for the write-it-yourself
     *  cards — same frame as the live thumbs, but showing what you WRITE
     *  rather than what renders. */
    snippet?: ReactNode;
    name: string;
    desc: string;
    onClick: () => void;
    /** Renders a small × control above the stretched button (draft cards). */
    onDelete?: () => void;
    disabled?: boolean;
    modifier?: string;
    testid?: string;
}) {
    const noIframe = !iframesAllowed();
    return (
        <div
            className={[
                "builder-card",
                thumb || snippet ? "builder-card-thumbed" : "",
                thumb && noIframe ? "builder-card-spined" : "",
                disabled ? "is-disabled" : "",
                modifier ?? "",
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {thumb &&
                (noIframe ? (
                    // No-iframe hosts (Polkadot Mobile) can't render a live
                    // preview; a left accent spine hints at the site theme
                    // without a stray top strip or wasted vertical height.
                    <div
                        className="builder-card-spine"
                        aria-hidden="true"
                        style={{ background: thumb.accent }}
                    />
                ) : (
                    <div className="builder-thumb" aria-hidden="true">
                        <iframe
                            key={htmlKey}
                            srcDoc={thumb.html}
                            sandbox=""
                            tabIndex={-1}
                            loading="lazy"
                            title={`${name} preview`}
                        />
                    </div>
                ))}
            {snippet && (
                <div className="builder-thumb builder-thumb-code" aria-hidden="true">
                    {snippet}
                </div>
            )}
            <button
                type="button"
                className="builder-card-button"
                onClick={onClick}
                disabled={disabled}
                data-testid={testid}
            >
                <span className="builder-card-name">{name}</span>
                <span className="builder-card-desc">{desc}</span>
            </button>
            {onDelete && (
                <button
                    type="button"
                    className="builder-card-delete"
                    onClick={onDelete}
                    aria-label={`Delete draft "${name}"`}
                    title="Delete draft"
                >
                    ×
                </button>
            )}
        </div>
    );
}

export default function Landing({
    drafts,
    onPick,
    onDelete,
    undoable,
    onUndo,
}: {
    drafts: DraftRecord[];
    onPick: (entry: BuilderEntry) => void;
    onDelete: (record: DraftRecord, index: number) => void;
    /** A just-deleted draft: its grid slot renders the in-place Undo card. */
    undoable: { record: DraftRecord; index: number } | null;
    onUndo: () => void;
}) {
    // Read once per landing mount (the landing remounts on every return
    // from the editor, so a fresh deploy shows up immediately).
    const deployedSites = useMemo(loadDeployedSites, []);

    // Draft thumbnails render through the same pipeline the editor's
    // preview/deploy use — the card always shows exactly what's saved.
    const draftPreviews = useMemo(
        () =>
            drafts.map((r) => ({
                html: draftHtml(r.draft),
                accent: r.draft.content.accentColor,
            })),
        [drafts],
    );
    // Template thumbnails: build() mints fresh block ids per call, but these
    // instances are preview-only — picking a card calls build() anew.
    const templatePreviews = useMemo(
        () =>
            TEMPLATES.map((t) => {
                const content = t.build();
                return {
                    html: renderHtml(content),
                    accent: content.accentColor,
                };
            }),
        [],
    );
    const atCap = drafts.length >= MAX_DRAFTS;
    return (
        <div className="builder-landing">
            <header className="builder-landing-header">
                <h1 className="builder-landing-title">dotpages</h1>
                <p className="builder-landing-lead">
                    Build and launch your own decentralised website. Start from a
                    template, or jump straight into Markdown or HTML.
                </p>
            </header>
            {(drafts.length > 0 || undoable) && (
                <section className="builder-section">
                    <h2 className="builder-section-title">Continue</h2>
                    <div className="builder-grid">
                        {(() => {
                            const cards = drafts.map((r, i) => (
                                <StartCard
                                    key={r.id}
                                    thumb={draftPreviews[i]}
                                    htmlKey={`${r.id}:${r.updatedAt}`}
                                    name={draftTitle(r.draft)}
                                    desc={
                                        MODE_NAMES[r.draft.mode] +
                                        (r.updatedAt > 0 ? ` · ${timeAgo(r.updatedAt)}` : "")
                                    }
                                    onClick={() =>
                                        onPick({ kind: "resume", id: r.id, draft: r.draft })
                                    }
                                    onDelete={() => onDelete(r, i)}
                                    modifier="builder-card-resume"
                                    testid="builder-resume"
                                />
                            ));
                            if (undoable) {
                                // The deleted card's own slot becomes the undo
                                // affordance — the user's eyes are already there.
                                cards.splice(
                                    Math.min(undoable.index, cards.length),
                                    0,
                                    <div
                                        key="undo-slot"
                                        className="builder-card builder-card-undo"
                                        role="status"
                                    >
                                        <span className="builder-card-undo-title">
                                            "{draftTitle(undoable.record.draft)}" deleted
                                        </span>
                                        <button type="button" onClick={onUndo}>
                                            Undo
                                        </button>
                                    </div>,
                                );
                            }
                            return cards;
                        })()}
                    </div>
                    {atCap && (
                        <p className="builder-note">
                            Draft limit reached ({MAX_DRAFTS}) — delete a draft
                            to start a new one.
                        </p>
                    )}
                </section>
            )}
            <section className="builder-section">
                <h2 className="builder-section-title">Start from a layout</h2>
                <div className="builder-grid">
                    {TEMPLATES.map((t, i) => (
                        <StartCard
                            key={t.id}
                            thumb={templatePreviews[i]}
                            name={t.name}
                            desc={t.description}
                            disabled={atCap}
                            onClick={() =>
                                onPick({ kind: "template", id: newDraftId(), template: t })
                            }
                        />
                    ))}
                </div>
            </section>
            <section className="builder-section">
                <h2 className="builder-section-title">Or build it yourself</h2>
                <div className="builder-grid">
                    <StartCard
                        snippet={MD_SNIPPET}
                        name="Markdown"
                        desc="Plain-text editing with the same site design."
                        disabled={atCap}
                        onClick={() =>
                            onPick({ kind: "blank", id: newDraftId(), mode: "markdown" })
                        }
                    />
                    <StartCard
                        snippet={HTML_SNIPPET}
                        name="HTML"
                        desc="CodePen-style HTML, CSS & JS panes."
                        disabled={atCap}
                        onClick={() =>
                            onPick({ kind: "blank", id: newDraftId(), mode: "html" })
                        }
                    />
                </div>
            </section>
            {deployedSites.length > 0 && (
                <section className="builder-section" aria-label="Your deployed sites">
                    <h2 className="builder-section-title">Your sites</h2>
                    <div className="builder-sites-cloud">
                        {deployedSites.map((site) => (
                            <PopupLink
                                key={site.domain}
                                className="builder-site-chip"
                                href={site.url}
                            >
                                {site.domain}.dot
                            </PopupLink>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
