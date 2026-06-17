// Draft persistence + editor entry points. Pure logic (no React) so the
// landing page can read a draft without mounting the editor, and tests can
// import it without a DOM.
//
// Ported from playground-app/src/builder/draft.ts (the integrated build's
// multi-draft store). The only standalone-specific addition is a one-time
// migration that folds this app's earlier SINGLE-draft autosave
// (`hello-playground.draft.v1`) into the new draft LIST, so upgrading never
// loses the page someone had open.

import {
    assembleDocument,
    DEFAULT_CONTENT,
    escapeHtml,
    renderHtml,
    type Block,
    type SiteContent,
} from "./template.ts";
import { blocksToMarkdown, renderMarkdownHtml } from "./markdown.ts";
import type { Template } from "./templates.ts";

// Modes are chosen on the landing page and fixed for the session, with one
// exception: blocks ("Simple") can FORK to html — the conversion opens as a
// new draft and the Simple original is kept. No transition mutates or loses
// anything.
export type EditorMode = "blocks" | "markdown" | "html";

export const MODE_NAMES: Record<EditorMode, string> = {
    blocks: "Simple",
    markdown: "Markdown",
    html: "HTML",
};

// Draft autosave: the full editing state, debounced into localStorage so a
// refresh/crash never loses work. Undo history is session-only by design.
// A LIST of drafts, so starting a new layout never clobbers existing work.
const STORAGE_KEY = "site-builder.drafts.v1";
// The pre-multi-draft single-slot key. Migrated once into STORAGE_KEY.
const LEGACY_SINGLE_KEY = "hello-playground.draft.v1";

// Bounds the landing page's draft list, not storage (drafts are KBs — images
// live on Bulletin as URLs). At the cap the landing BLOCKS new starts with an
// explicit message; nothing is ever silently evicted.
export const MAX_DRAFTS = 10;

export interface Draft {
    mode: EditorMode;
    content: SiteContent;
    markdownText: string;
    htmlText: string;
    cssText: string;
    jsText: string;
}

/** A site's live publication. Present on a record iff the site has been
 *  deployed. `domain` is the bare label (no `.dot`); re-opening a published
 *  site prefills this so a re-deploy updates the same domain in place. No
 *  content snapshot is stored — the record's canonical `draft` IS the live
 *  content (see `working` below), so divergence is a `draft`↔`working` compare. */
export interface Deployment {
    /** Bare label, no `.dot` suffix. */
    domain: string;
    /** Live site URL as returned by the deploy. */
    url: string;
    deployedAt: number;
}

export interface DraftRecord {
    id: string;
    /** Last save, ms epoch — orders the landing list, newest first. */
    updatedAt: number;
    /**
     * Unpublished draft: the editable content.
     * PUBLISHED site (`deployment` set): the LIVE content — the exact thing
     * last deployed. Edits never touch this; they land in `working`, so the
     * canonical stays a faithful record of what's live until a re-deploy
     * promotes `working` into it.
     */
    draft: Draft;
    /** Set iff the site is live. Absence = it's still a draft. */
    deployment?: Deployment;
    /** Pending edits to a published site, not yet re-deployed. Drives the
     *  "Unpublished changes" pill. Unused for unpublished drafts. */
    working?: Draft;
}

/** How the editor is entered from the landing page. `id` is the draft slot the
 *  session autosaves into — minted fresh for template/blank starts, so a new
 *  start never touches existing drafts. A `resume` of a published site carries
 *  its `deployment` so the editor can prefill the domain and a re-deploy can
 *  update in place. */
export type BuilderEntry =
    | { kind: "resume"; id: string; draft: Draft; deployment?: Deployment }
    | { kind: "template"; id: string; template: Template }
    | { kind: "blank"; id: string; mode: Exclude<EditorMode, "blocks"> };

export function newDraftId(): string {
    return makeBlockId();
}

export function makeBlockId(): string {
    return Math.random().toString(36).slice(2, 10);
}

// localStorage is user-writable and schema versions drift — a draft block
// missing a required string field crashed render (escapeHtml(undefined)),
// and unknown block types rendered as "undefined". Keep only blocks that
// match the model, defaulting the per-block strings; theme fields default
// to the blank template's values. Corrupt-beyond-JSON records are dropped
// by loadDrafts' validation instead.
function sanitizeContent(c: SiteContent): SiteContent {
    const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
    const blocks: Block[] = (Array.isArray(c.blocks) ? c.blocks : [])
        .filter((b): b is Block => !!b && typeof b === "object" && typeof b.type === "string")
        .flatMap((b): Block[] => {
            const id = str(b.id) || makeBlockId();
            switch (b.type) {
                case "heading":
                case "paragraph":
                    return [{ id, type: b.type, text: str(b.text) }];
                case "link":
                    return [{ ...b, id, label: str(b.label), url: str(b.url) }];
                case "image":
                    return [{ ...b, id, url: str(b.url), alt: str(b.alt) }];
                case "divider":
                    return [{ id, type: "divider" }];
                default:
                    return []; // unknown type — drop rather than render "undefined"
            }
        });
    return {
        ...c,
        accentColor: str(c.accentColor, "#e6007a"),
        background: str(c.background, "#0b0d12"),
        fontFamily: str(c.fontFamily, "system-ui"),
        blocks,
    };
}

// A draft from storage: shape-gate plus defaulting the text panes
// (user-writable storage — never trust a field exists).
function validateDraft(d: unknown): Draft | null {
    if (!d || typeof d !== "object") return null;
    const draft = d as Draft;
    if (!draft.content || !Array.isArray(draft.content.blocks)) return null;
    if (!["blocks", "markdown", "html"].includes(draft.mode)) return null;
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    return {
        mode: draft.mode,
        content: sanitizeContent(draft.content),
        markdownText: str(draft.markdownText),
        htmlText: str(draft.htmlText),
        cssText: str(draft.cssText),
        jsText: str(draft.jsText),
    };
}

// One-time upgrade from the single-slot autosave. Runs only when the new list
// is absent AND the legacy key holds a valid draft; the legacy key is then
// cleared so this never repeats. Best-effort — any storage error just skips it.
function migrateLegacySingleDraft(): void {
    try {
        if (localStorage.getItem(STORAGE_KEY) !== null) return;
        const raw = localStorage.getItem(LEGACY_SINGLE_KEY);
        if (!raw) return;
        const draft = validateDraft(JSON.parse(raw));
        localStorage.removeItem(LEGACY_SINGLE_KEY);
        if (!draft) return;
        const record: DraftRecord = { id: makeBlockId(), updatedAt: Date.now(), draft };
        localStorage.setItem(STORAGE_KEY, JSON.stringify([record]));
    } catch {
        // Unavailable/corrupt storage — start fresh.
    }
}

// A deployment from storage: every field shape-gated (user-writable storage).
// A malformed deployment is dropped, demoting the record back to a draft
// rather than rendering a broken "Your sites" card.
function validateDeployment(d: unknown): Deployment | null {
    if (!d || typeof d !== "object") return null;
    const dep = d as Deployment;
    if (typeof dep.domain !== "string" || !dep.domain) return null;
    if (typeof dep.url !== "string" || !dep.url) return null;
    return {
        domain: dep.domain,
        url: dep.url,
        deployedAt: typeof dep.deployedAt === "number" ? dep.deployedAt : 0,
    };
}

/** All records (drafts + published sites), newest first. Malformed records are
 *  dropped, not fatal. Callers split on `deployment` presence. */
export function loadDrafts(): DraftRecord[] {
    try {
        migrateLegacySingleDraft();
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const list: unknown = JSON.parse(raw);
        if (!Array.isArray(list)) return [];
        return list
            .flatMap((r): DraftRecord[] => {
                if (!r || typeof r !== "object") return [];
                const rec = r as DraftRecord;
                if (typeof rec.id !== "string" || !rec.id) return [];
                const draft = validateDraft(rec.draft);
                if (!draft) return [];
                const updatedAt = typeof rec.updatedAt === "number" ? rec.updatedAt : 0;
                const deployment = validateDeployment(rec.deployment) ?? undefined;
                // `working` only means something on a published record; a stray
                // working copy on a draft is harmless but dropped for tidiness.
                const working = deployment ? validateDraft(rec.working) ?? undefined : undefined;
                return [{ id: rec.id, updatedAt, draft, deployment, working }];
            })
            .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
        // Unavailable storage (private mode, sandbox) or corrupt JSON.
        return [];
    }
}

/** Autosave one slot. Routes by publication state: a PUBLISHED record's edits
 *  land in `working` (the live `draft` stays put until a re-deploy promotes
 *  it); an unpublished record edits `draft` directly. Loading first re-validates
 *  the whole list, so a corrupt sibling gets dropped rather than resaved. */
export function saveDraft(id: string, draft: Draft): void {
    try {
        const records = loadDrafts();
        const existing = records.find((r) => r.id === id);
        const rest = records.filter((r) => r.id !== id);
        const next: DraftRecord = existing?.deployment
            ? { ...existing, updatedAt: Date.now(), working: draft }
            : { id, updatedAt: Date.now(), draft };
        rest.unshift(next);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    } catch {
        // Storage full/unavailable — autosave is best-effort.
    }
}

/** Mark a site live (first deploy) or refresh its publication (re-deploy to
 *  the SAME domain). Promotes any `working` edits into the canonical `draft`
 *  and clears `working`, so the record's `draft` again equals what's live. */
export function publishSite(id: string, deployment: Deployment): void {
    try {
        const records = loadDrafts();
        const existing = records.find((r) => r.id === id);
        const canonical = existing?.working ?? existing?.draft;
        if (!canonical) return; // nothing to publish (slot vanished)
        const rest = records.filter((r) => r.id !== id);
        rest.unshift({ id, updatedAt: Date.now(), draft: canonical, deployment });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    } catch {
        // best-effort
    }
}

/** Fork a published site to a NEW domain: the edited (`working`) content becomes
 *  a brand-new published record `newId`, and the SOURCE record's `working` is
 *  discarded so the original returns to its untouched, still-live state. */
export function forkSite(srcId: string, newId: string, deployment: Deployment): void {
    try {
        const records = loadDrafts();
        const src = records.find((r) => r.id === srcId);
        const forkContent = src?.working ?? src?.draft;
        if (!forkContent) return;
        const cleaned = records
            .filter((r) => r.id !== newId)
            .map((r) => (r.id === srcId ? { ...r, working: undefined } : r));
        cleaned.unshift({ id: newId, updatedAt: Date.now(), draft: forkContent, deployment });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    } catch {
        // best-effort
    }
}

/** Re-insert a deleted draft with its ORIGINAL timestamp — the undo half
 *  of delete-with-undo (delete acts immediately, undo is the safety net). */
export function restoreDraft(record: DraftRecord): void {
    try {
        const records = loadDrafts().filter((r) => r.id !== record.id);
        records.push(record);
        records.sort((a, b) => b.updatedAt - a.updatedAt);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {
        // best-effort
    }
}

export function deleteDraft(id: string): void {
    try {
        const records = loadDrafts().filter((r) => r.id !== id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {
        // best-effort
    }
}

/** The draft's page title for the landing page's resume card. Display-only:
 *  no entity decoding, first heading wins, same h1–h3 rule as titleFromHtml. */
export function draftTitle(d: Draft): string {
    const fallback = "Untitled page";
    switch (d.mode) {
        case "blocks": {
            for (const b of d.content.blocks) {
                if (b.type === "heading") return b.text.trim() || fallback;
            }
            return fallback;
        }
        case "markdown": {
            const m = d.markdownText.match(/^#{1,3}\s+(.+)$/m);
            return m?.[1].trim() || fallback;
        }
        case "html": {
            const m = d.htmlText.match(/<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/i);
            const text = m ? m[2].replace(/<[^>]*>/g, "").trim() : "";
            return text || fallback;
        }
    }
}

/** The draft rendered as the same standalone document the editor's preview
 *  and deploy consume (switched on the saved mode). Feeds the landing page's
 *  resume-card thumbnail. */
export function draftHtml(d: Draft): string {
    switch (d.mode) {
        case "blocks":
            return renderHtml(d.content);
        case "markdown":
            return renderMarkdownHtml(d.markdownText, d.content);
        case "html":
            return assembleDocument({
                title: escapeHtml(draftTitle(d)),
                css: d.cssText,
                bodyHtml: d.htmlText,
                js: d.jsText,
            });
    }
}

// Fast, dependency-free 53-bit string hash (cyrb53). Used only to compare a
// published site's working edits against what's live — never for security.
function cyrb53(s: string): string {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
        const ch = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Stable fingerprint of the document a draft would DEPLOY. Hashing the
 *  rendered `draftHtml` (not the raw model) means two drafts that produce
 *  byte-identical sites compare equal, and it's deterministic — `draftHtml`
 *  pulls in no randomness (unlike `deriveDomain`). */
export function hashDraft(d: Draft): string {
    return cyrb53(draftHtml(d));
}

/** The content to show/edit for a record: a published site's pending `working`
 *  edits if any, else its canonical `draft`. */
export function editableDraft(r: DraftRecord): Draft {
    return r.working ?? r.draft;
}

/** True when a published site has local edits that aren't live yet — drives
 *  the landing's "Unpublished changes" pill. Only meaningful for published
 *  records; a draft is never "diverged". */
export function hasUnpublishedChanges(r: DraftRecord): boolean {
    if (!r.deployment || !r.working) return false;
    return hashDraft(r.working) !== hashDraft(r.draft);
}

// Blank HTML start: a small working document across all three panes. The CSS
// sets background/color EXPLICITLY — the preview iframe is transparent when
// the document paints no background, so an unstyled page would render its
// default black text straight onto the app's dark canvas. The JS is the
// minimal proof the script pane runs.
const STARTER_HTML = `<h1>Hello, world</h1>
<p>This is your page. Edit the HTML, CSS, and JS panes.</p>
<button id="greet">Click me</button>
<p id="output"></p>
`;
const STARTER_CSS = `body {
    margin: 0;
    padding: 64px 24px;
    background: #0b0d12;
    color: #f5f5f5;
    font-family: system-ui, sans-serif;
    line-height: 1.5;
}
h1 {
    color: #e6007a;
}
button {
    padding: 10px 20px;
    border: 0;
    border-radius: 999px;
    background: #e6007a;
    color: #fff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
}
button:hover {
    opacity: 0.85;
}
`;
const STARTER_JS = `const button = document.getElementById("greet");
const output = document.getElementById("output");
let clicks = 0;
button.addEventListener("click", () => {
    clicks += 1;
    output.textContent = \`Hello! You clicked \${clicks} time\${clicks === 1 ? "" : "s"}.\`;
});
`;

/** Initial editing state for an entry picked on the landing page. Blank
 *  markdown seeds from DEFAULT_CONTENT exactly like the in-editor convert
 *  path, so both routes into markdown start from the same document. */
export function initialStateForEntry(entry: BuilderEntry): Draft {
    switch (entry.kind) {
        case "resume":
            return entry.draft;
        case "template":
            return {
                mode: "blocks",
                content: entry.template.build(),
                markdownText: "",
                htmlText: "",
                cssText: "",
                jsText: "",
            };
        case "blank":
            return entry.mode === "markdown"
                ? {
                      mode: "markdown",
                      content: DEFAULT_CONTENT,
                      markdownText: blocksToMarkdown(DEFAULT_CONTENT),
                      htmlText: "",
                      cssText: "",
                      jsText: "",
                  }
                : {
                      mode: "html",
                      content: DEFAULT_CONTENT,
                      markdownText: "",
                      htmlText: STARTER_HTML,
                      cssText: STARTER_CSS,
                      jsText: STARTER_JS,
                  };
    }
}
