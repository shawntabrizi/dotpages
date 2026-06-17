// Landing page — the launcher the app opens to. The Instagram shape:
// launcher -> picker -> editor. Picking a template implies blocks mode
// (templates build SiteContent); Markdown and HTML start blank in their
// respective modes. Every start mints a fresh draft slot — existing drafts are
// never replaced, only explicitly deleted (capped at MAX_DRAFTS, blocked with
// a message).
//
// Ported from playground-app/src/builder/Landing.tsx, minus the playground-only
// onboarding gate (BecomeBuilderCard / useOnboarding). Live-site links use
// PopupLink so they open in the host browser inside Polkadot, and a new tab
// in a standalone browser.

import { useMemo, type ReactNode } from "react";
import { PopupLink } from "./LinkPopup.tsx";
import AccountBar from "./AccountBar.tsx";
import { TEMPLATES } from "./templates.ts";
import { renderHtml } from "./template.ts";
import { iframesAllowed } from "./iframes.ts";
import { loadDeployedSites } from "./deployed.ts";
import {
    draftHtml,
    draftTitle,
    editableDraft,
    hasUnpublishedChanges,
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
    pill,
    liveHref,
    onClick,
    onDelete,
    deleteLabel,
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
    /** Small status chip (e.g. "Unpublished changes") shown on the card. */
    pill?: string;
    /** When set, renders a "View live" link to the deployed site. */
    liveHref?: string;
    onClick: () => void;
    /** Renders a small × control above the stretched button (draft / site cards). */
    onDelete?: () => void;
    /** aria-label/tooltip for the × — "Delete draft" vs "Remove from list". */
    deleteLabel?: string;
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
            {pill && <span className="builder-card-pill">{pill}</span>}
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
            {liveHref && (
                // The stretched button can't nest a link; the live link sits
                // beside it as a sibling footer affordance (z-index above the
                // overlay so it opens the live site, not the editor).
                <PopupLink className="builder-card-live" href={liveHref}>
                    View live ↗
                </PopupLink>
            )}
            {onDelete && (
                <button
                    type="button"
                    className="builder-card-delete"
                    onClick={onDelete}
                    aria-label={deleteLabel ?? `Delete draft "${name}"`}
                    title={deleteLabel ?? "Delete draft"}
                >
                    ×
                </button>
            )}
        </div>
    );
}

// The just-deleted/untracked card's own slot becomes the undo affordance —
// the user's eyes are already there. Shared by both sections.
function UndoCard({ title, onUndo }: { title: string; onUndo: () => void }) {
    return (
        <div className="builder-card builder-card-undo" role="status">
            <span className="builder-card-undo-title">{title}</span>
            <button type="button" onClick={onUndo}>
                Undo
            </button>
        </div>
    );
}

export default function Landing({
    sites,
    onPick,
    onDelete,
    undoable,
    onUndo,
}: {
    /** All records — drafts and published sites. Split here by `deployment`. */
    sites: DraftRecord[];
    onPick: (entry: BuilderEntry) => void;
    onDelete: (record: DraftRecord, index: number) => void;
    /** A just-removed record: its grid slot renders the in-place Undo card.
     *  `index` is the slot WITHIN its own section (drafts vs published). */
    undoable: { record: DraftRecord; index: number } | null;
    onUndo: () => void;
}) {
    // Split: published sites (live, editable) vs drafts (never deployed). Both
    // keep newest-first from loadDrafts.
    const published = useMemo(() => sites.filter((s) => s.deployment), [sites]);
    const drafts = useMemo(() => sites.filter((s) => !s.deployment), [sites]);

    // Legacy "Your sites" entries from before sites carried source — show them
    // as link-only chips, but only where a real editable record hasn't taken
    // over the same domain.
    const legacySites = useMemo(() => {
        const liveDomains = new Set(published.map((s) => s.deployment!.domain));
        return loadDeployedSites().filter((s) => !liveDomains.has(s.domain));
    }, [published]);

    // Thumbnails render through the same pipeline the editor's preview/deploy
    // use — the card always shows what's saved (a published site's working
    // edits if any, else its live content).
    const publishedPreviews = useMemo(
        () =>
            published.map((r) => {
                const d = editableDraft(r);
                return { html: draftHtml(d), accent: d.content.accentColor };
            }),
        [published],
    );
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
    // The cap bounds work-in-progress DRAFTS, not published sites — deploying
    // frees a slot, and you can keep as many live sites as you've shipped.
    const atCap = drafts.length >= MAX_DRAFTS;
    // The undo slot belongs to whichever section the removed record came from.
    const undoForDrafts = undoable && !undoable.record.deployment ? undoable : null;
    const undoForPublished = undoable && undoable.record.deployment ? undoable : null;
    return (
        <div className="builder-landing">
            <header className="builder-landing-header">
                <div className="builder-landing-headings">
                    <h1 className="builder-landing-title">dotpages</h1>
                    <p className="builder-landing-lead">
                        Build and launch your own decentralised website. Start from a
                        template, or jump straight into Markdown or HTML.
                    </p>
                </div>
                <AccountBar />
            </header>
            {(published.length > 0 || legacySites.length > 0 || undoForPublished) && (
                <section className="builder-section" aria-label="Your deployed sites">
                    <h2 className="builder-section-title">Your sites</h2>
                    <div className="builder-grid">
                        {(() => {
                            const cards = published.map((r, i) => {
                                const d = editableDraft(r);
                                const dirty = hasUnpublishedChanges(r);
                                return (
                                    <StartCard
                                        key={r.id}
                                        thumb={publishedPreviews[i]}
                                        htmlKey={`${r.id}:${r.updatedAt}`}
                                        name={draftTitle(d)}
                                        desc={`${r.deployment!.domain}.dot`}
                                        pill={dirty ? "Unpublished changes" : undefined}
                                        liveHref={r.deployment!.url}
                                        onClick={() =>
                                            onPick({
                                                kind: "resume",
                                                id: r.id,
                                                draft: d,
                                                deployment: r.deployment,
                                            })
                                        }
                                        onDelete={() => onDelete(r, i)}
                                        deleteLabel="Remove from this list (your live site stays up)"
                                        modifier="builder-card-resume"
                                        testid="builder-site"
                                    />
                                );
                            });
                            if (undoForPublished) {
                                cards.splice(
                                    Math.min(undoForPublished.index, cards.length),
                                    0,
                                    <UndoCard
                                        key="undo-slot"
                                        title={`"${draftTitle(editableDraft(undoForPublished.record))}" removed`}
                                        onUndo={onUndo}
                                    />,
                                );
                            }
                            return cards;
                        })()}
                    </div>
                    {legacySites.length > 0 && (
                        <div className="builder-sites-cloud">
                            {legacySites.map((site) => (
                                <PopupLink
                                    key={site.domain}
                                    className="builder-site-chip"
                                    href={site.url}
                                >
                                    {site.domain}.dot
                                </PopupLink>
                            ))}
                        </div>
                    )}
                </section>
            )}
            {(drafts.length > 0 || undoForDrafts) && (
                <section className="builder-section">
                    <h2 className="builder-section-title">Drafts</h2>
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
                                    deleteLabel={`Delete draft "${draftTitle(r.draft)}"`}
                                    modifier="builder-card-resume"
                                    testid="builder-resume"
                                />
                            ));
                            if (undoForDrafts) {
                                cards.splice(
                                    Math.min(undoForDrafts.index, cards.length),
                                    0,
                                    <UndoCard
                                        key="undo-slot"
                                        title={`"${draftTitle(undoForDrafts.record.draft)}" deleted`}
                                        onUndo={onUndo}
                                    />,
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
        </div>
    );
}
