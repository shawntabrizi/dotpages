import React, { useEffect, useMemo, useRef, useState } from "react";
import { Editable } from "./Editable.tsx";

// Lazy: CodeMirror is its own chunk, fetched only when md/html mode is opened.
const CodeEditor = React.lazy(() => import("./CodeEditor.tsx"));
import type { EditorHandle } from "./CodeEditor.tsx";
import {
    assembleDocument,
    DEFAULT_FONT_SIZE,
    escapeHtml,
    FONT_OPTIONS,
    renderHtml,
    renderHtmlParts,
    imageShape,
    imageSize,
    siteColors,
    validateUrl,
    type Block,
    type ImageShape,
    type ImageVariant,
    type SiteContent,
    type TextAlign,
} from "./template.ts";
// Chain-stack modules (deploy/preflight/store pull polkadot-api, viem,
// descriptors metadata, multiformats — ~1.5 MB) are loaded on demand at
// their call sites via dynamic import(); only their TYPES are imported
// statically (erased at compile time).
import type { DeploySuccess } from "./deploy.ts";
import { type PreflightReport, validateLabel } from "./preflight.ts";
import { deployButtonState } from "./deployButton.ts";
import { deriveDomain } from "./derive-domain.ts";
import { signInToHost, useHostState } from "./signer.ts";
import { ensureHostPermission } from "./lib/host/permissions.ts";
import {
    type ActiveAccount,
    getDevAccount,
    hasInjectedExtension,
    resolveHostAccount,
    tryExtensionAccount,
} from "./account.ts";
import { MAX_TX_BYTES } from "./lib/bulletin/limits.ts";
import { BULLETIN_FAUCET_URL, DOT_HOST } from "./lib/polkadot/constants.ts";
import { MAX_IMAGE_DIMENSION, resizeImageToFit } from "./image-resize.ts";
import { TEMPLATES, type Template } from "./templates.ts";
import {
    blocksToMarkdown,
    renderMarkdownHtml,
    renderMarkdownParts,
} from "./markdown.ts";
// Draft model + landing entry points live in draft.ts (pure, React-free) so the
// landing page reads drafts without mounting the editor. The editor below is
// entered with a BuilderEntry and autosaves into that draft's slot.
import {
    initialStateForEntry,
    saveDraft,
    loadDrafts,
    deleteDraft,
    restoreDraft,
    makeBlockId,
    type BuilderEntry,
    type Draft,
    type DraftRecord,
    type EditorMode,
} from "./draft.ts";
import Landing from "./Landing.tsx";
import { recordDeployedSite } from "./deployed.ts";
import { easedStepProgress, PROGRESS_TAU_MS } from "./progress.ts";

type View = "edit" | "preview" | "deploy";
// The one-way "eject" ladder: blocks → markdown → html are exact conversions;
// going back up restores the last block-editor state (kept in memory) and
// discards the text edits — never a lossy parse. (EditorMode is defined in
// draft.ts and imported above.)
// One open menu at a time — a single state slot makes overlap impossible.
type ActionMenu = "layout" | "colors" | "font" | "add" | "mode";
// HTML mode is CodePen-style: three panes assembled into one document.
type HtmlPane = "html" | "css" | "js";
const PANE_GLYPHS: Record<HtmlPane, string> = { html: "<>", css: "{}", js: "JS" };

// Decode HTML entities (&#39; &amp; …) to plain text. The blocks renderer
// entity-encodes heading text, so anything extracted from rendered markup
// must be decoded before non-HTML use — "sveta&#39;s" fed to deriveDomain
// turned into "sveta-39-s". textarea innerHTML never executes content.
function decodeEntities(s: string): string {
    const el = document.createElement("textarea");
    el.innerHTML = s;
    return el.value;
}

// Title for assembled pane documents and the auto-name seed: the first
// <h1>–<h3>'s text in document order, falling back to the same default the
// blocks renderer uses. Returns DECODED plain text — escape it again before
// embedding in markup (assembleDocument's title contract).
function titleFromHtml(body: string): string {
    const m = body.match(/<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/i);
    const text = m ? decodeEntities(m[2].replace(/<[^>]*>/g, "")).trim() : "";
    return text || "hello";
}
type DeployResult = DeploySuccess;

interface ProgressStep {
    readonly id: string;
    readonly label: string;
}

const DEPLOY_STEPS: readonly ProgressStep[] = [
    { id: "prepare", label: "Prepare" },
    { id: "bulletin", label: "Store" },
    { id: "account", label: "Account" },
    { id: "name", label: "Name" },
    { id: "commit", label: "Commit" },
    { id: "wait", label: "Wait" },
    { id: "register", label: "Register" },
    { id: "link", label: "Link" },
];

const UPLOAD_STEPS: readonly ProgressStep[] = [
    { id: "prepare", label: "Prepare" },
    { id: "sign", label: "Sign" },
    { id: "broadcast", label: "Broadcast" },
    { id: "in-block", label: "In Block" },
    { id: "finalized", label: "Finalized" },
];

function stepForUploadStatus(message: string): number {
    if (message.startsWith("signing")) return 1;
    if (message.startsWith("broadcasting")) return 2;
    if (message.startsWith("in-block")) return 3;
    if (message.startsWith("finalized")) return 4;
    return 0;
}

function stepForDeployStatus(message: string): number {
    if (message.startsWith("Bulletin:")) return 1;
    if (message.startsWith("DotNS: resolving owner")) return 2;
    if (message.startsWith("DotNS: checking domain")) return 3;
    // Owned-name update path skips commit/wait/register entirely.
    if (message.startsWith("DotNS: name already yours")) return 6;
    if (message.startsWith("DotNS register: Waiting")) return 5;
    if (
        message.startsWith("DotNS register: Pricing") ||
        message.startsWith("DotNS register: Signing registration") ||
        message.startsWith("DotNS register: Domain registered")
    ) {
        return 6;
    }
    if (message.startsWith("DotNS register:")) return 4;
    if (message.startsWith("DotNS resolver:")) return 7;
    if (message.startsWith("DotNS step failed")) return 7;
    return 0;
}

// Host-signed upload budgets — empirical, since the host's "message too big"
// threshold isn't queryable. Start here, halve per rejection, give up below
// the floor (a sub-32 KB image means something else is wrong).
const HOST_SIGN_BUDGET = 256 * 1024;
const MIN_SIGN_BUDGET = 32 * 1024;

// Draft persistence (load/save/sanitize/migrate) + makeBlockId now live in
// draft.ts, shared with the landing page. The editor receives a BuilderEntry
// and autosaves into that draft's slot via saveDraft(entry.id, …).

// Add-menu entries. Link and Button are presented as two separate components
// (a Button is a pill-styled link under the hood — no toggle between them).
const BLOCK_PRESETS = {
    heading: () => ({ id: makeBlockId(), type: "heading", text: "Heading" }),
    paragraph: () => ({ id: makeBlockId(), type: "paragraph", text: "Write something here…" }),
    link: () => ({ id: makeBlockId(), type: "link", label: "Link text", url: "https://" }),
    button: () => ({
        id: makeBlockId(),
        type: "link",
        variant: "pill",
        label: "Button text",
        url: "https://",
    }),
    image: () => ({ id: makeBlockId(), type: "image", url: "https://", alt: "" }),
    divider: () => ({ id: makeBlockId(), type: "divider" }),
} satisfies Record<string, () => Block>;
type BlockPreset = keyof typeof BLOCK_PRESETS;

// The editor. Entered from the landing page with a BuilderEntry (resume a
// draft, start from a template, or a blank markdown/html start). All edits
// autosave into entry.id; `onExit` returns to the landing page.
function Editor({ entry, onExit }: { entry: BuilderEntry; onExit: () => void }) {
    // Build the starting document once (templates mint fresh block ids, so this
    // must not re-run on every render).
    const [initial] = useState(() => initialStateForEntry(entry));
    const [content, setContent] = useState<SiteContent>(initial.content);
    const [mode, setMode] = useState<EditorMode>(initial.mode);
    const [markdownText, setMarkdownText] = useState(initial.markdownText);
    // HTML mode panes: body markup, stylesheet, script — CodePen-style.
    const [htmlText, setHtmlText] = useState(initial.htmlText);
    const [cssText, setCssText] = useState(initial.cssText);
    const [jsText, setJsText] = useState(initial.jsText);
    const [htmlPane, setHtmlPane] = useState<HtmlPane>("html");
    const [view, setView] = useState<View>("edit");
    const [domain, setDomain] = useState("");
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [deployStep, setDeployStep] = useState<number | null>(null);
    const [result, setResult] = useState<DeployResult | null>(null);
    const [deployError, setDeployError] = useState<string | null>(null);
    // Raw technical detail shown in the LogsModal when the user taps "View logs".
    const [logsText, setLogsText] = useState<string | null>(null);
    // "Copied ✓" toggle for the success card's copy-link button.
    const [copiedUrl, setCopiedUrl] = useState(false);
    const [openMenu, setOpenMenu] = useState<ActionMenu | null>(null);
    // Which structured block (link/button/image) has its bottom sheet open.
    const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
    const toggleMenu = (menu: ActionMenu) =>
        setOpenMenu((prev) => (prev === menu ? null : menu));

    // Signer state — host-first (this app's primary environment is Polkadot
    // Desktop/Mobile), browser extension as standalone fallback, //Bob behind
    // an explicit dev toggle.
    const [useDevAccount, setUseDevAccount] = useState(false);
    const [hostAccount, setHostAccount] = useState<ActiveAccount | null>(null);
    const [extensionAccount, setExtensionAccount] = useState<ActiveAccount | null>(null);
    const [resolvingOwned, setResolvingOwned] = useState(true);
    const [ownedError, setOwnedError] = useState<string | null>(null);
    /** Advisory remaining byte allowance — null when unknown, N/A (host
     *  route), or non-positive (the soft counters never gate anyway). */
    const [maxStoreBytes, setMaxStoreBytes] = useState<number | null>(null);
    /** Distinct from the budget: false = CHECKED and unauthorized (direct
     *  route would fail) — fail fast with the faucet link. null = unknown. */
    const [bulletinAuthorized, setBulletinAuthorized] = useState<boolean | null>(null);

    const devAccount = useMemo(() => getDevAccount(), []);
    const activeAccount: ActiveAccount | null = useDevAccount
        ? devAccount
        : hostAccount ?? extensionAccount;

    // Resolve the host on mount — the default signer when running inside
    // Polkadot Desktop/Mobile. Retries while the (async) mobile bridge
    // injects; resolves to null quickly in a plain browser.
    useEffect(() => {
        let cancelled = false;
        resolveHostAccount()
            .then((account) => {
                if (!cancelled && account) setHostAccount(account);
            })
            .catch((cause) => {
                if (!cancelled)
                    setOwnedError(cause instanceof Error ? cause.message : String(cause));
            })
            .finally(() => {
                if (!cancelled) setResolvingOwned(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // Host session state — distinguishes "no host" from "host present but
    // signed out of dotli" (the latter gets a sign-in CTA).
    const hostState = useHostState();
    const hostSignedOut = hostState.status === "signed-out";
    const handleHostSignIn = async () => {
        setOwnedError(null);
        setResolvingOwned(true);
        try {
            const state = await signInToHost();
            const account = state.account;
            if (state.status === "ready" && account) {
                setHostAccount({
                    source: "host",
                    address: account.address,
                    displayName: account.displayName ?? account.address,
                    signer: account.signer,
                });
            }
        } catch (cause) {
            setOwnedError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setResolvingOwned(false);
        }
    };

    useEffect(() => {
        const address = activeAccount?.address;
        // Host accounts store via the host's preimage channel — no Bulletin
        // authorization (and no Bulletin RPC connection) needed.
        if (!address || activeAccount?.source === "host") {
            setMaxStoreBytes(null);
            setBulletinAuthorized(null);
            return;
        }
        let cancelled = false;
        import("./lib/bulletin/store.ts")
            .then(({ checkBulletinAuthorization }) => checkBulletinAuthorization(address))
            .then((auth) => {
                if (cancelled) return;
                setBulletinAuthorized(auth.authorized);
                const remaining = auth.bytesAllowance - auth.bytesUsed;
                setMaxStoreBytes(
                    auth.authorized && remaining > 0n ? Number(remaining) : null,
                );
            })
            .catch(() => {
                if (!cancelled) {
                    setMaxStoreBytes(null);
                    setBulletinAuthorized(null);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [activeAccount?.address]);

    // ── Deploy pre-flight ────────────────────────────────────────────────
    // The auto-derived label has random padding, so it's generated ONCE per
    // session and shown in the field — the name the checklist verifies is
    // byte-for-byte the name deployFull registers.
    const [autoLabel, setAutoLabel] = useState<string | null>(null);
    const [preflight, setPreflight] = useState<PreflightReport | null>(null);
    const [preflightBusy, setPreflightBusy] = useState(false);
    // The label the last completed check ran for — drives `checkFresh`. A name
    // edit invalidates it, so the button reverts from "Deploy" to re-checking.
    const [checkedLabel, setCheckedLabel] = useState<string | null>(null);
    // The last check attempt errored (flaky RPC) — surfaces "Check again".
    const [preflightFailed, setPreflightFailed] = useState(false);
    // Bumped by "Check again" to force a re-run of the (otherwise input-driven)
    // pre-flight effect.
    const [recheckNonce, setRecheckNonce] = useState(0);
    // Reveals the developer-facing `tech` detail on each checklist row.
    const [showCheckDetails, setShowCheckDetails] = useState(false);
    const [copiedAddress, setCopiedAddress] = useState(false);
    const effectiveLabel = domain.trim().replace(/\.dot$/i, "") || autoLabel || "";

    // Intentionally narrow deps: derive once, on the first visit to the
    // deploy view, from whatever the content is at that moment. Seed from
    // the page's <h1> text (uniform across all three modes) — NOT the raw
    // document, whose first bytes are doctype boilerplate.
    useEffect(() => {
        if (view === "deploy" && !autoLabel) {
            setAutoLabel(deriveDomain(titleFromHtml(currentHtml())));
        }
    }, [view, autoLabel]); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-run the checklist whenever the deploy view is open and any input
    // changes (account, name, content via view switch). Debounced so name
    // keystrokes don't hammer the RPC; all checks are read-only dry-runs.
    useEffect(() => {
        if (view !== "deploy" || !activeAccount || !effectiveLabel) {
            setPreflight(null);
            return;
        }
        let cancelled = false;
        setPreflightBusy(true);
        setPreflightFailed(false);
        setResult(null); // inputs changed — a previous deploy result is stale
        const t = setTimeout(() => {
            import("./preflight.ts")
                .then(({ runPreflight }) =>
                    runPreflight({
                        html: currentHtml(),
                        label: effectiveLabel,
                        account: activeAccount,
                    }),
                )
                .then((report) => {
                    if (cancelled) return;
                    setPreflight(report);
                    setCheckedLabel(effectiveLabel);
                })
                .catch(() => {
                    if (cancelled) return;
                    setPreflight(null);
                    setPreflightFailed(true);
                    setCheckedLabel(effectiveLabel);
                })
                .finally(() => {
                    if (!cancelled) setPreflightBusy(false);
                });
        }, 400);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
        // currentHtml is stable for a given content/mode; content edits can
        // only happen in the edit view, so the `view` dep re-checks on return.
        // recheckNonce lets "Check again" force a re-run.
    }, [view, effectiveLabel, activeAccount, recheckNonce]); // eslint-disable-line react-hooks/exhaustive-deps

    // Debounced draft autosave — every edit lands in localStorage shortly after.
    const draft: Draft = { mode, content, markdownText, htmlText, cssText, jsText };
    const draftRef = useRef(draft);
    draftRef.current = draft;
    useEffect(() => {
        const t = setTimeout(() => saveDraft(entry.id, draft), 500);
        return () => clearTimeout(t);
    }, [mode, content, markdownText, htmlText, cssText, jsText]); // eslint-disable-line react-hooks/exhaustive-deps
    // Flush synchronously when the page is leaving/backgrounding, so an edit
    // made within the debounce window survives a reload or mobile app-switch.
    useEffect(() => {
        const flush = () => saveDraft(entry.id, draftRef.current);
        const onVisibility = () => {
            if (document.visibilityState === "hidden") flush();
        };
        window.addEventListener("pagehide", flush);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            window.removeEventListener("pagehide", flush);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, []);

    // Blocks-mode undo: a snapshot stack over SiteContent. Snapshots are taken
    // OUTSIDE setState updaters (StrictMode double-invokes those) and rapid
    // keystrokes coalesce into one entry per ~800ms burst.
    const contentRef = useRef(content);
    contentRef.current = content;
    const undoStack = useRef<SiteContent[]>([]);
    const redoStack = useRef<SiteContent[]>([]);
    const lastEditAt = useRef(0);
    const snapshotContent = (force = false) => {
        const now = Date.now();
        if (force || now - lastEditAt.current > 800) {
            undoStack.current.push(contentRef.current);
            if (undoStack.current.length > 100) undoStack.current.shift();
        }
        lastEditAt.current = now;
        redoStack.current = [];
    };
    const undoBlocks = () => {
        const prev = undoStack.current.pop();
        if (!prev) return;
        redoStack.current.push(contentRef.current);
        lastEditAt.current = 0; // next edit starts a fresh undo group
        setContent(prev);
    };
    const redoBlocks = () => {
        const next = redoStack.current.pop();
        if (!next) return;
        undoStack.current.push(contentRef.current);
        lastEditAt.current = 0;
        setContent(next);
    };

    // Undo/redo for the CodeMirror editor (markdown/html modes), surfaced by
    // the lazy component once its view mounts.
    const [editorHandle, setEditorHandle] = useState<EditorHandle | null>(null);

    const update = <K extends keyof SiteContent>(key: K, value: SiteContent[K]) => {
        snapshotContent();
        setContent((prev) => ({ ...prev, [key]: value }));
    };
    const updateBlock = (id: string, patcher: (b: Block) => Block) => {
        snapshotContent();
        setContent((prev) => ({
            ...prev,
            blocks: prev.blocks.map((b) => (b.id === id ? patcher(b) : b)),
        }));
    };
    const removeBlock = (id: string) => {
        snapshotContent(true);
        setContent((prev) => ({ ...prev, blocks: prev.blocks.filter((b) => b.id !== id) }));
    };
    const addBlock = (type: BlockPreset) => {
        snapshotContent(true);
        setContent((prev) => ({ ...prev, blocks: [...prev.blocks, BLOCK_PRESETS[type]()] }));
        setOpenMenu(null);
    };

    // Applying a template snapshots into the undo stack like any other edit —
    // the floating Undo button is the recovery path (no separate toast).
    const applyTemplate = (template: Template) => {
        snapshotContent(true);
        setContent(template.build());
        setOpenMenu(null);
    };

    // The single HTML source of truth — preview and deploy both consume this,
    // so they stay mode-agnostic.
    // `interactive` is false only for the live preview iframe, so the baked
    // dotpages credit doesn't navigate while you're still in the editor.
    // Deploy/size all use the default (true) — the real, host-aware badge ships.
    const currentHtml = (interactive = true): string => {
        switch (mode) {
            case "blocks":
                return renderHtml(content);
            case "markdown":
                return renderMarkdownHtml(markdownText, content, interactive);
            case "html":
                return assembleDocument({
                    title: escapeHtml(titleFromHtml(htmlText)),
                    css: cssText,
                    bodyHtml: htmlText,
                    js: jsText,
                });
        }
    };

    const convertToMarkdown = () => {
        if (
            !window.confirm(
                "Convert to Markdown?\n\nYour content becomes plain text — headings, lists, and code become possible. You can return to the simple editor later, but text edits won't carry back.",
            )
        )
            return;
        setMarkdownText(blocksToMarkdown(content));
        setMode("markdown");
        setOpenMenu(null);
    };
    const convertToHtml = () => {
        if (
            !window.confirm(
                "Convert to HTML, CSS & JS?\n\nYour page splits into editable HTML, CSS, and JavaScript panes. You can return to the simple editor later, but edits here won't carry back.",
            )
        )
            return;
        const parts =
            mode === "markdown"
                ? renderMarkdownParts(markdownText, content)
                : renderHtmlParts(content);
        setHtmlText(parts.bodyHtml);
        setCssText(parts.css);
        setJsText("");
        setHtmlPane("html");
        setMode("html");
        setOpenMenu(null);
    };
    const backToSimple = () => {
        if (
            !window.confirm(
                "Back to the simple editor?\n\nThis restores your last simple editor state. Your Markdown/HTML edits will be discarded.",
            )
        )
            return;
        setMode("blocks");
        setOpenMenu(null);
    };
    // Upward hop html → markdown: restore the last markdown state, or derive a
    // fresh one from the block content if markdown was never visited.
    const backToMarkdown = () => {
        if (
            !window.confirm(
                "Back to Markdown?\n\nThis restores your last Markdown state. Your HTML edits will be discarded.",
            )
        )
            return;
        if (!markdownText) setMarkdownText(blocksToMarkdown(content));
        setMode("markdown");
        setOpenMenu(null);
    };
    // The Mode menu always lists all three modes; route the transition.
    const switchMode = (target: EditorMode) => {
        if (target === mode) {
            setOpenMenu(null);
            return;
        }
        if (target === "blocks") backToSimple();
        else if (target === "markdown") {
            if (mode === "blocks") convertToMarkdown();
            else backToMarkdown();
        } else {
            convertToHtml();
        }
    };

    const uploadImage = async (
        file: File,
        onStatus: (msg: string) => void,
    ): Promise<string> => {
        if (!activeAccount) {
            throw new Error(
                "Sign in first — tick the dev account in the Deploy panel, or connect a wallet.",
            );
        }
        // Checked-and-unauthorized fails fast with the faucet link, BEFORE
        // the user sits through image optimization for a store that must
        // fail. (null = unknown/host route — proceed and let the deploy path
        // verify; an exhausted-but-valid allowance is also not a failure,
        // the soft counters only deprioritize.)
        if (activeAccount.source !== "host" && bulletinAuthorized === false) {
            throw new Error(
                `No Bulletin storage authorization for ${activeAccount.displayName}.\n\n` +
                    `Self-serve faucet:\n${BULLETIN_FAUCET_URL}`,
            );
        }
        // Every upload is optimized: downscaled to the largest dimension the
        // page can display (1280px) and re-encoded — images that already fit
        // pass through untouched. The byte budget is the smaller of the chain's
        // per-tx cap and the remaining allowance (chain cap when unknown).
        const chainLimit = Math.min(MAX_TX_BYTES, maxStoreBytes ?? MAX_TX_BYTES);
        // The host signing channel rejects large payloads with an opaque
        // "message too big" — the limit isn't published anywhere we can
        // query, and it's far below the chain's 2 MiB cap. Host-signed
        // uploads start from a conservative budget; on rejection we halve
        // and re-encode (the host rejects before any approval prompt, so
        // retries don't cost the user taps).
        // Host uploads go through the host's preimage channel (no signing) but
        // still cross the host message bridge — keep the adaptive budget.
        let budget =
            activeAccount.source === "host"
                ? Math.min(chainLimit, HOST_SIGN_BUDGET)
                : chainLimit;
        for (;;) {
            onStatus("Optimizing image…");
            const resized = await resizeImageToFit(file, Math.floor(budget * 0.95));
            const bytes = resized.bytes;
            const label = `Image (${resized.filename || "untitled"})`;
            onStatus(
                resized.finalBytes !== resized.originalBytes
                    ? `Optimized ${(resized.originalBytes / 1024).toFixed(0)} KB → ${(resized.finalBytes / 1024).toFixed(0)} KB. Uploading…`
                    : "Uploading to Bulletin…",
            );
            try {
                const { storeBytes } = await import("./lib/bulletin/store.ts");
                const stored = await storeBytes({
                    bytes,
                    signer: activeAccount.signer,
                    signerAddress: activeAccount.address,
                    displayName: activeAccount.displayName,
                    label,
                    viaHost: activeAccount.source === "host",
                    onStatus,
                });
                return stored.ipfsUrl;
            } catch (cause) {
                const message = cause instanceof Error ? cause.message : String(cause);
                const next = Math.floor(budget / 2);
                if (!/too big|too large/i.test(message) || next < MIN_SIGN_BUDGET) {
                    throw cause;
                }
                budget = next;
                onStatus(
                    `Signer rejected the size — retrying at ${(budget / 1024).toFixed(0)} KB…`,
                );
            }
        }
    };

    // Upload state lives HERE, keyed by block id — not in the bottom sheet.
    // Uploads outlive the sheet (close/reopen mid-upload keeps progress
    // visible) and completion patches the CURRENT block, so edits made while
    // uploading aren't reverted by a stale copy.
    const [uploads, setUploads] = useState<Record<string, string>>({});
    const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
    const startImageUpload = async (blockId: string, file: File) => {
        if (uploads[blockId]) return; // one upload per block at a time
        setUploadErrors(({ [blockId]: _drop, ...rest }) => rest);
        setUploads((prev) => ({ ...prev, [blockId]: "Reading file…" }));
        try {
            const url = await uploadImage(file, (msg) =>
                setUploads((prev) => ({ ...prev, [blockId]: msg })),
            );
            updateBlock(blockId, (b) =>
                b.type === "image" ? { ...b, url, alt: b.alt || file.name } : b,
            );
        } catch (cause) {
            setUploadErrors((prev) => ({
                ...prev,
                [blockId]: cause instanceof Error ? cause.message : String(cause),
            }));
        } finally {
            setUploads(({ [blockId]: _drop, ...rest }) => rest);
        }
    };

    const connectExtension = async () => {
        setOwnedError(null);
        try {
            const account = await tryExtensionAccount();
            if (account) setExtensionAccount(account);
            else
                setOwnedError(
                    "No browser wallet found. Install Talisman, SubWallet, or Polkadot.js — or tick the dev account checkbox.",
                );
        } catch (cause) {
            setOwnedError(cause instanceof Error ? cause.message : String(cause));
        }
    };

    const deploy = async () => {
        setBusy(true);
        setResult(null);
        setDeployError(null);
        setDeployStep(0);
        setStatus("Preparing deploy…");
        const updateDeployStatus = (message: string) => {
            setStatus(message);
            // Monotonic: the pipelined deploy interleaves Bulletin statuses
            // (step 1) with the commitment wait (step 5) — keep the bar at
            // the furthest stage reached instead of bouncing backward.
            setDeployStep((prev) => Math.max(prev ?? 0, stepForDeployStatus(message)));
        };
        try {
            if (!activeAccount || !effectiveLabel) {
                throw new Error("No account connected or no name resolved");
            }
            // RFC-0002: the DotNS contract calls go through host-mediated
            // transaction submission, which needs ChainSubmit granted.
            if (activeAccount.source === "host") {
                await ensureHostPermission("ChainSubmit");
            }
            const { deployFull } = await import("./deploy.ts");
            const stored = await deployFull(
                currentHtml(),
                effectiveLabel,
                activeAccount,
                updateDeployStatus,
            );
            setResult(stored);
            // Feed the landing page's "Your sites" list (local, this device).
            if (stored.dotMapped) recordDeployedSite(stored.domain, stored.gatewayUrl);
        } catch (cause) {
            setDeployError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setBusy(false);
            setStatus(null);
            setDeployStep(null);
        }
    };

    const isEditing = view === "edit";
    const editingBlock =
        isEditing && mode === "blocks"
            ? content.blocks.find((b) => b.id === editingBlockId) ?? null
            : null;
    // Primary deploy-button state (pure derivation). The checklist auto-runs,
    // so a fresh result is usually already in hand: a clean pass shows "Deploy";
    // a non-pass shows "Check again" + a secondary "Try to deploy anyway".
    const checkFresh = checkedLabel !== null && checkedLabel === effectiveLabel;
    const localOk = effectiveLabel !== "" && validateLabel(effectiveLabel) === null;
    const deployBtn = deployButtonState({
        busy,
        preflightBusy,
        hasAccount: activeAccount !== null,
        hasName: effectiveLabel !== "",
        localOk,
        checkFresh,
        preflightOk: preflight?.ok ?? null,
        preflightFailed,
    });
    const runCheck = () => setRecheckNonce((n) => n + 1);
    const onPrimaryClick = () => {
        // "deploy" = a fresh pass → deploy. "check"/"checkAgain" → (re-)run the
        // bounded check. The chain re-verifies, so "Try to deploy anyway" (the
        // secondary, rendered on checkAgain) is the escape hatch.
        if (deployBtn.mode === "deploy") void deploy();
        else runCheck();
    };
    const copyAddress = async () => {
        if (!activeAccount) return;
        try {
            await navigator.clipboard.writeText(activeAccount.address);
            setCopiedAddress(true);
            setTimeout(() => setCopiedAddress(false), 1500);
        } catch {
            // Clipboard unavailable (permissions/insecure context) — the
            // address is still selectable text.
        }
    };
    const copyLiveUrl = async () => {
        if (!result) return;
        try {
            await navigator.clipboard.writeText(result.url);
            setCopiedUrl(true);
            setTimeout(() => setCopiedUrl(false), 1500);
        } catch {
            // Clipboard unavailable — the link is still selectable text.
        }
    };
    const showOwnedHint =
        !useDevAccount &&
        !hostAccount &&
        !extensionAccount &&
        !resolvingOwned &&
        !hostSignedOut; // signed-out gets the sign-in CTA instead

    const colors = siteColors(content.background);
    const foreground = content.textColor ?? colors.foreground;
    const siteStyle = {
        background: content.background,
        fontFamily: content.fontFamily,
        fontSize: content.fontSize ?? DEFAULT_FONT_SIZE,
        textAlign: content.align,
        color: foreground,
        "--site-foreground": foreground,
        "--site-divider": colors.divider,
        "--site-accent": content.accentColor,
    } as React.CSSProperties;

    return (
        <>
            {mode !== "blocks" &&
                (isEditing ? (
                    <main className="code-pane">
                        <div className="code-card">
                            <div className="code-card-header" aria-hidden="true">
                                {mode === "markdown"
                                    ? "README.md"
                                    : htmlPane === "css"
                                      ? "styles.css"
                                      : htmlPane === "js"
                                        ? "script.js"
                                        : "index.html"}
                            </div>
                        <React.Suspense
                            fallback={
                                <div className="code-editor-loading">
                                    Loading editor…
                                </div>
                            }
                        >
                            <CodeEditor
                                cacheKey={entry.id}
                                language={mode === "markdown" ? "markdown" : htmlPane}
                                value={
                                    mode === "markdown"
                                        ? markdownText
                                        : htmlPane === "css"
                                          ? cssText
                                          : htmlPane === "js"
                                            ? jsText
                                            : htmlText
                                }
                                onChange={(v) => {
                                    if (mode === "markdown") setMarkdownText(v);
                                    else if (htmlPane === "css") setCssText(v);
                                    else if (htmlPane === "js") setJsText(v);
                                    else setHtmlText(v);
                                }}
                                placeholder={
                                    mode === "html" && htmlPane === "js"
                                        ? "// Runs at the end of <body>"
                                        : undefined
                                }
                                ariaLabel={
                                    mode === "markdown"
                                        ? "Markdown source"
                                        : `${htmlPane.toUpperCase()} source`
                                }
                                onHandle={setEditorHandle}
                            />
                        </React.Suspense>
                        </div>
                    </main>
                ) : (
                    // Preview IS the deploy artifact. sandbox without
                    // allow-same-origin: pasted scripts run, but in an opaque
                    // origin that can't reach the app (and its signer).
                    <iframe
                        className="site-frame"
                        title="Site preview"
                        srcDoc={currentHtml(false)}
                        sandbox="allow-scripts allow-popups"
                    />
                ))}

            {mode === "blocks" && (
            <main className={`site ${isEditing ? "is-editing" : ""}`} style={siteStyle}>
                <article className="site-inner">
                    {content.blocks.map((block) => (
                        <BlockView
                            key={block.id}
                            block={block}
                            accentColor={content.accentColor}
                            editable={isEditing}
                            onUpdate={(b) => updateBlock(block.id, () => b)}
                            onRemove={() => removeBlock(block.id)}
                            onEdit={() => setEditingBlockId(block.id)}
                            uploadStatus={uploads[block.id] ?? null}
                        />
                    ))}
                    {isEditing && content.blocks.length === 0 && (
                        <p className="site-tip">
                            Click any text to edit. Use the + button below to add
                            paragraphs, links, or images — make it your own.
                        </p>
                    )}
                    {/* Mirrors the footer wrapMain() bakes into the artifact, but
                        intentionally INERT here: this is the author's own canvas
                        and the credit only needs to be clickable for visitors on
                        the deployed site. An href-less <a> keeps the styling. */}
                    <footer className="site-footer">
                        made with{" "}
                        <a style={{ color: content.accentColor }}>dotpages.dot</a>
                    </footer>
                </article>
            </main>
            )}

            {/* Floating action bar — visible only in edit view; sits above the bottom nav pill. */}
            {isEditing && (
                <div className="float-bottom">
                    {/* Undo/redo satellites: same spot in every mode, thumb-zone
                        reachable, 40px touch targets. */}
                    <button
                        className="float-circle"
                        onClick={
                            mode === "blocks" ? undoBlocks : () => editorHandle?.undo()
                        }
                        disabled={
                            mode === "blocks"
                                ? undoStack.current.length === 0
                                : !editorHandle?.canUndo()
                        }
                        title="Undo"
                        aria-label="Undo"
                    >
                        <UndoIcon />
                    </button>
                    <div className="action-bar" role="toolbar" aria-label="Site styling">
                        {mode === "blocks" && (
                        <div className="tmpl-wrap action-item">
                            <button
                                className="action-btn"
                                onClick={() => toggleMenu("layout")}
                                aria-haspopup="menu"
                                aria-expanded={openMenu === "layout"}
                                title="Pick a starter layout"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 14 14"
                                    fill="currentColor"
                                    aria-hidden="true"
                                >
                                    <rect x="0" y="0" width="6" height="6" rx="1" />
                                    <rect x="8" y="0" width="6" height="6" rx="1" />
                                    <rect x="0" y="8" width="6" height="6" rx="1" />
                                    <rect x="8" y="8" width="6" height="6" rx="1" />
                                </svg>
                            </button>
                            {openMenu === "layout" && (
                                <div className="tmpl-menu" role="menu">
                                    {TEMPLATES.map((t) => (
                                        <button
                                            key={t.id}
                                            onClick={() => applyTemplate(t)}
                                            role="menuitem"
                                        >
                                            <span className="tmpl-name">{t.name}</span>
                                            <span className="tmpl-desc">{t.description}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            <span className="action-label" aria-hidden="true">
                                Layout
                            </span>
                        </div>
                        )}
                        {mode !== "html" && (
                        <>
                        <div className="colors-wrap action-item">
                            <button
                                className="action-btn"
                                onClick={() => toggleMenu("colors")}
                                aria-haspopup="menu"
                                aria-expanded={openMenu === "colors"}
                                title="Colors"
                            >
                                <PaletteIcon />
                            </button>
                            {openMenu === "colors" && (
                                <div className="colors-menu" role="menu">
                                    <StyleRow
                                        label="Accent"
                                        value={content.accentColor}
                                        onChange={(v) => update("accentColor", v)}
                                    />
                                    <StyleRow
                                        label="Background"
                                        value={content.background}
                                        onChange={(v) => update("background", v)}
                                    />
                                    <StyleRow
                                        label="Text"
                                        value={foreground}
                                        onChange={(v) => update("textColor", v)}
                                    >
                                        {content.textColor && (
                                            <button
                                                className="style-auto"
                                                onClick={() =>
                                                    update("textColor", undefined)
                                                }
                                                title="Auto-pick for contrast against the background"
                                            >
                                                Auto
                                            </button>
                                        )}
                                    </StyleRow>
                                </div>
                            )}
                            <span className="action-label" aria-hidden="true">
                                Colors
                            </span>
                        </div>
                        <div className="font-wrap action-item">
                            <button
                                className="action-btn font-btn"
                                onClick={() => toggleMenu("font")}
                                aria-haspopup="menu"
                                aria-expanded={openMenu === "font"}
                                title="Font family"
                            >
                                Aa
                            </button>
                            {openMenu === "font" && (
                                <div className="font-menu" role="menu">
                                    {FONT_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.value}
                                            role="menuitem"
                                            className={
                                                content.fontFamily === opt.value
                                                    ? "is-active"
                                                    : ""
                                            }
                                            style={{ fontFamily: opt.value }}
                                            onClick={() => {
                                                update("fontFamily", opt.value);
                                                setOpenMenu(null);
                                            }}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                    <FontSizeStepper
                                        value={parseInt(
                                            content.fontSize ?? DEFAULT_FONT_SIZE,
                                            10,
                                        )}
                                        onChange={(n) => update("fontSize", `${n}px`)}
                                    />
                                    <div
                                        className="font-size-row font-align-row"
                                        role="group"
                                        aria-label="Text alignment"
                                    >
                                        {(["left", "center"] as const).map((a) => (
                                            <button
                                                key={a}
                                                className={
                                                    (content.align ?? "left") === a
                                                        ? "is-active"
                                                        : ""
                                                }
                                                onClick={() =>
                                                    update("align", a as TextAlign)
                                                }
                                            >
                                                {a === "left" ? "Left" : "Center"}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <span className="action-label" aria-hidden="true">
                                Font
                            </span>
                        </div>
                        </>
                        )}
                        {mode === "blocks" && (
                        <div className="add-wrap action-item">
                            <button
                                className="action-btn"
                                onClick={() => toggleMenu("add")}
                                aria-haspopup="menu"
                                aria-expanded={openMenu === "add"}
                                title="Add element"
                            >
                                +
                            </button>
                            {openMenu === "add" && (
                                <div className="add-menu" role="menu">
                                    <button onClick={() => addBlock("heading")}>
                                        Heading
                                    </button>
                                    <button onClick={() => addBlock("paragraph")}>
                                        Paragraph
                                    </button>
                                    <button onClick={() => addBlock("link")}>Link</button>
                                    <button onClick={() => addBlock("button")}>
                                        Button
                                    </button>
                                    <button onClick={() => addBlock("image")}>Image</button>
                                    <button onClick={() => addBlock("divider")}>Divider</button>
                                </div>
                            )}
                            <span className="action-label" aria-hidden="true">
                                Add
                            </span>
                        </div>
                        )}
                        {mode === "html" &&
                            (["html", "css", "js"] as const).map((pane) => (
                                <div key={pane} className="action-item">
                                    <button
                                        className={`action-btn pane-btn ${
                                            htmlPane === pane ? "is-active" : ""
                                        }`}
                                        onClick={() => setHtmlPane(pane)}
                                        aria-pressed={htmlPane === pane}
                                        title={`Edit ${pane.toUpperCase()}`}
                                    >
                                        {PANE_GLYPHS[pane]}
                                    </button>
                                    <span className="action-label" aria-hidden="true">
                                        {pane.toUpperCase()}
                                    </span>
                                </div>
                            ))}
                        <ModeSwitcher
                            mode={mode}
                            open={openMenu === "mode"}
                            onToggle={() => toggleMenu("mode")}
                            onSelect={switchMode}
                        />
                    </div>
                    <button
                        className="float-circle"
                        onClick={
                            mode === "blocks" ? redoBlocks : () => editorHandle?.redo()
                        }
                        disabled={
                            mode === "blocks"
                                ? redoStack.current.length === 0
                                : !editorHandle?.canRedo()
                        }
                        title="Redo"
                        aria-label="Redo"
                    >
                        <RedoIcon />
                    </button>
                </div>
            )}

            {editingBlock && (
                <BlockEditSheet
                    block={editingBlock}
                    onUpdate={(b) => updateBlock(editingBlock.id, () => b)}
                    onDelete={() => {
                        removeBlock(editingBlock.id);
                        setEditingBlockId(null);
                    }}
                    onClose={() => setEditingBlockId(null)}
                    onUpload={(file) => startImageUpload(editingBlock.id, file)}
                    uploadStatus={uploads[editingBlock.id] ?? null}
                    uploadError={uploadErrors[editingBlock.id] ?? null}
                    maxStoreBytes={Math.min(MAX_TX_BYTES, maxStoreBytes ?? MAX_TX_BYTES)}
                />
            )}

            {/* Deploy panel — visible only in deploy view. Once the site is
                live, the success card REPLACES the form (name/checklist/button
                are spent context); editing or switching views clears `result`. */}
            {view === "deploy" && (
                <div className="deploy-panel" role="region" aria-label="Deploy">
                    {result?.dotMapped ? (
                        <div className="result-success" role="status">
                            <span className="result-success-check" aria-hidden="true">
                                <CheckIcon size={22} />
                            </span>
                            <p className="result-success-title">Your site is live</p>
                            <p className="result-success-domain">
                                {result.domain}.{DOT_HOST}
                                <button
                                    type="button"
                                    className={`result-success-copy${copiedUrl ? " copied" : ""}`}
                                    onClick={copyLiveUrl}
                                    title="Copy the site link"
                                    aria-label="Copy the site link"
                                >
                                    {copiedUrl ? <CheckIcon size={15} /> : <CopyIcon />}
                                </button>
                            </p>
                            <p className="result-success-hint">
                                Resolution can take a few seconds to propagate.
                            </p>
                            <a
                                className="result-success-open"
                                href={result.url}
                                target="_blank"
                                rel="noopener"
                            >
                                Open your site
                            </a>
                            <button
                                type="button"
                                className="result-success-another"
                                onClick={onExit}
                            >
                                Build another site
                            </button>
                        </div>
                    ) : (
                    <>
                    <h2 className="deploy-title">Deploy your site</h2>

                    <div className="deploy-field">
                        <span className="field-label">Account</span>
                        <div className="account-row">
                            <span className="account-chip">
                                <span
                                    className={`source-dot source-${activeAccount?.source ?? "none"}`}
                                />
                                {activeAccount
                                    ? activeAccount.source === "dev"
                                        ? activeAccount.displayName
                                        : `${activeAccount.displayName} (${activeAccount.source})`
                                    : resolvingOwned
                                      ? "connecting…"
                                      : "no signer"}
                            </span>
                            <label className="checkbox" title="Throwaway local signer — no wallet needed">
                                <input
                                    type="checkbox"
                                    checked={useDevAccount}
                                    onChange={(e) => setUseDevAccount(e.target.checked)}
                                    disabled={busy}
                                />
                                <span>Dev account</span>
                            </label>
                        </div>
                        {activeAccount && (
                            <button
                                type="button"
                                className="account-address"
                                onClick={copyAddress}
                                title="Copy address"
                            >
                                <code>{activeAccount.address}</code>
                                <span className="copy-state">
                                    {copiedAddress ? "copied ✓" : "copy"}
                                </span>
                            </button>
                        )}
                        {!useDevAccount && !activeAccount && hostSignedOut && (
                            <button
                                className="pill pill-secondary"
                                onClick={handleHostSignIn}
                                disabled={resolvingOwned || busy}
                            >
                                Sign in to Polkadot
                            </button>
                        )}
                        {!useDevAccount && !hostAccount && !extensionAccount && !hostSignedOut && (
                            <button
                                className="pill pill-secondary"
                                onClick={connectExtension}
                                disabled={!hasInjectedExtension() || resolvingOwned || busy}
                            >
                                Connect browser wallet
                            </button>
                        )}
                        {showOwnedHint && (
                            <p className="hint">
                                No host signer detected. Open in{" "}
                                <strong>Polkadot Desktop</strong> or{" "}
                                <strong>Polkadot Mobile</strong>, connect a browser wallet,
                                or tick the dev option below.
                            </p>
                        )}
                        {ownedError && <p className="hint subtle">{ownedError}</p>}
                    </div>

                    <div className="deploy-field">
                        <label className="field">
                            <span className="field-label">.dot name</span>
                            <input
                                type="text"
                                placeholder={autoLabel ?? "auto-generated if blank"}
                                value={domain}
                                onChange={(e) =>
                                    setDomain(e.target.value.trim().toLowerCase())
                                }
                                disabled={busy}
                            />
                        </label>
                    </div>

                    <div className="deploy-field">
                        <span className="field-label">URL</span>
                        <span className="url-preview">
                            {`https://${effectiveLabel || "<auto>"}.${DOT_HOST}`}
                        </span>
                    </div>

                    {/* Pre-flight checklist — read-only checks, auto-run. */}
                    {!busy && (preflight || preflightBusy) && (
                        <div className="preflight" role="status" aria-label="Pre-flight checks">
                            {preflight?.checks.map((check) => (
                                <div
                                    key={check.id}
                                    className={`check-row check-${check.state}`}
                                >
                                    <span className="check-icon" aria-hidden="true">
                                        {check.state === "ok"
                                            ? "✓"
                                            : check.state === "warn"
                                              ? "!"
                                              : "✕"}
                                    </span>
                                    <span className="check-label">{check.label}</span>
                                    <span className="check-detail">
                                        {showCheckDetails && check.tech
                                            ? check.tech
                                            : check.detail}
                                        {check.link && (
                                            <>
                                                {" — "}
                                                <a
                                                    href={check.link}
                                                    target="_blank"
                                                    rel="noopener"
                                                >
                                                    faucet
                                                </a>
                                            </>
                                        )}
                                    </span>
                                </div>
                            ))}
                            {preflightBusy && (
                                <p className="hint subtle">
                                    {preflight ? "Re-checking…" : "Running pre-flight checks…"}
                                </p>
                            )}
                            {preflight && !preflightBusy && (
                                <button
                                    type="button"
                                    className={`check-details-toggle${showCheckDetails ? " active" : ""}`}
                                    onClick={() => setShowCheckDetails((v) => !v)}
                                    aria-expanded={showCheckDetails}
                                >
                                    {showCheckDetails ? "Hide developer details" : "Developer details"}
                                </button>
                            )}
                        </div>
                    )}

                    <button
                        className="pill pill-primary pill-wide"
                        onClick={onPrimaryClick}
                        disabled={deployBtn.disabled}
                    >
                        {deployBtn.label}
                    </button>
                    {/* A fresh check that didn't pass: re-check is the primary
                        fix, but the chain is the real authority, so offer a
                        direct deploy beside it (advice, not a block). */}
                    {deployBtn.mode === "checkAgain" && (
                        <button
                            type="button"
                            className="pill pill-secondary pill-wide"
                            onClick={() => void deploy()}
                        >
                            Try to deploy anyway
                        </button>
                    )}

                    {busy && status && deployStep !== null && (
                        <StepProgress
                            steps={DEPLOY_STEPS}
                            step={deployStep}
                            status={status}
                            phoneSteps={DEPLOY_PHONE_STEPS}
                        />
                    )}

                    {/* Partial success: bytes are on Bulletin but the .dot
                        mapping failed — the site is reachable via the gateway. */}
                    {result && !result.dotMapped && (() => {
                        const action = failureAction(
                            result.dotError ?? "",
                            "Check your balance or pick a different name, then deploy again.",
                        );
                        return (
                            <div className="result result-partial">
                                <p className="result-live-title">
                                    <CheckIcon size={18} /> Your site is live
                                </p>
                                <div className="result-link-row">
                                    <a
                                        className="result-link"
                                        href={result.gatewayUrl}
                                        target="_blank"
                                        rel="noopener"
                                    >
                                        {result.gatewayUrl}
                                    </a>
                                </div>
                                <p className="result-note">
                                    We weren't able to register your domain:{" "}
                                    <code>{result.domain}.{DOT_HOST}</code>. {action}
                                </p>
                                {result.dotError && (
                                    <button
                                        type="button"
                                        className="link-btn"
                                        onClick={() => setLogsText(result.dotError)}
                                    >
                                        View logs
                                    </button>
                                )}
                            </div>
                        );
                    })()}
                    {deployError && (() => {
                        const action = failureAction(
                            deployError,
                            "Check your balance, then deploy again.",
                        );
                        return (
                            <div className="result result-error">
                                <p className="result-fail-title">Deployment didn't finish</p>
                                <p className="result-note">{action}</p>
                                <button
                                    type="button"
                                    className="link-btn"
                                    onClick={() => setLogsText(deployError)}
                                >
                                    View logs
                                </button>
                            </div>
                        );
                    })()}
                    </>
                    )}
                </div>
            )}
            {logsText && <LogsModal text={logsText} onClose={() => setLogsText(null)} />}

            {/* Bottom centered nav — 3 tabs, always visible. */}
            <nav className="bottom-nav" aria-label="View">
                <div className="bottom-nav-pill">
                    <NavTab
                        active={false}
                        onClick={onExit}
                        icon={<BackIcon />}
                        label="Start"
                    />
                    <NavTab
                        active={view === "edit"}
                        onClick={() => {
                            setView("edit");
                            setOpenMenu(null);
                        }}
                        icon={<PencilIcon />}
                        label="Edit"
                    />
                    <NavTab
                        active={view === "preview"}
                        onClick={() => {
                            setView("preview");
                            setOpenMenu(null);
                        }}
                        icon={<EyeIcon />}
                        label="Preview"
                    />
                    <NavTab
                        active={view === "deploy"}
                        onClick={() => {
                            setView("deploy");
                            setOpenMenu(null);
                        }}
                        icon={<RocketIcon />}
                        label="Deploy"
                    />
                </div>
            </nav>
        </>
    );
}

// App entry: the landing page (drafts + templates), with the editor taking
// over once the user picks a starting point. Mirrors the integrated build's
// BuilderTab, minus react-router — this app's landing IS its home.
export default function App() {
    const [entry, setEntry] = useState<BuilderEntry | null>(null);
    const [drafts, setDrafts] = useState(() => loadDrafts());
    // Delete acts immediately with a 6s undo window; the deleted card's slot
    // renders the undo affordance in place.
    const [undoable, setUndoable] = useState<{ record: DraftRecord; index: number } | null>(null);
    const undoTimer = useRef<number | null>(null);
    const handleDelete = (record: DraftRecord, index: number) => {
        deleteDraft(record.id);
        setDrafts(loadDrafts());
        setUndoable({ record, index });
        if (undoTimer.current) clearTimeout(undoTimer.current);
        undoTimer.current = window.setTimeout(() => setUndoable(null), 6000);
    };
    const handleUndo = () => {
        if (!undoable) return;
        if (undoTimer.current) clearTimeout(undoTimer.current);
        restoreDraft(undoable.record);
        setDrafts(loadDrafts());
        setUndoable(null);
    };
    // Re-read drafts whenever we return to the landing, so a just-exited
    // session's autosave shows up (the editor flushes on unmount/pagehide).
    useEffect(() => {
        if (entry === null) setDrafts(loadDrafts());
    }, [entry]);

    if (!entry)
        return (
            <Landing
                drafts={drafts}
                onPick={setEntry}
                onDelete={handleDelete}
                undoable={undoable}
                onUndo={handleUndo}
            />
        );
    // Keyed on entry.id so picking a different start fully remounts the editor.
    return <Editor key={entry.id} entry={entry} onExit={() => setEntry(null)} />;
}

// Map a raw failure (deploy error / dotError) to one plain-English next action.
// Timeout first: a stalled connection (deadline.ts) isn't an on-chain failure,
// and retrying is safe because completed steps are reused.
function failureAction(message: string, fallback: string): string {
    const m = message.toLowerCase();
    if (m.includes("timed out") || m.includes("took too long")) {
        return "The connection stalled before this step finished — your completed steps are saved, so just deploy again.";
    }
    if (
        m.includes("balance") ||
        m.includes("transferfailed") ||
        m.includes("fundsunavailable") ||
        m.includes("inability to pay") ||
        m.includes("storage deposit")
    ) {
        return "Add some test tokens to your account, then deploy again.";
    }
    if (m.includes("already registered") || m.includes("already taken")) {
        return "That name is taken — pick another, then deploy again.";
    }
    if (m.includes("accountunmapped") || m.includes("mapping did not propagate")) {
        return "Your account is still finishing setup — wait a moment, then deploy again.";
    }
    return fallback;
}

// Raw technical detail, tucked behind a "View logs" link so the failure cards
// stay plain-English. Self-contained overlay (no shared modal dependency).
function LogsModal({ text, onClose }: { text: string; onClose: () => void }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // clipboard unavailable — the text is still selectable
        }
    };
    return (
        <div className="logs-modal-backdrop" onClick={onClose}>
            <div
                className="logs-modal"
                role="dialog"
                aria-label="Deploy logs"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="logs-modal-head">
                    <span>Deploy logs</span>
                    <button type="button" className="logs-modal-close" onClick={onClose} aria-label="Close">
                        ×
                    </button>
                </div>
                <p className="hint subtle">Technical detail for debugging — share this with a developer.</p>
                <pre className="logs-modal-body">{text}</pre>
                <button type="button" className="pill pill-wide" onClick={copy}>
                    {copied ? "Copied" : "Copy logs"}
                </button>
            </div>
        </div>
    );
}

// How long a single deploy step may run before the progress UI adds a "still
// working" reassurance. The eased fill (progress.ts) is flat near its cap by
// ~25s, so a step sitting past this should be told it isn't frozen.
const SLOW_STEP_HINT_MS = 18_000;

// Deploy steps whose transaction the user approves on their phone (host route)
// or signs in their extension — StepProgress shows a "check your phone" hint
// while one is active. The read-only dry-runs (account / name) are excluded.
const DEPLOY_PHONE_STEPS: ReadonlySet<string> = new Set([
    "prepare",
    "bulletin",
    "commit",
    "register",
    "link",
]);

function StepProgress({
    steps,
    step,
    status,
    phoneSteps,
}: {
    steps: readonly ProgressStep[];
    step: number;
    status: string;
    /** Step ids whose tx the user approves on their phone / signs in their
     *  extension — when the active step is one of these, a "check your phone"
     *  hint is shown. */
    phoneSteps?: ReadonlySet<string>;
}) {
    const currentStep = steps[Math.min(step, steps.length - 1)];
    const stepNumber = Math.min(step + 1, steps.length);
    const needsPhone = phoneSteps?.has(currentStep.id) ?? false;

    // Eased within-step fill for the active segment. The chain layer gives no
    // sub-progress for the slow broadcast/in-block wait, so we animate EXPECTED
    // progress (see progress.ts) — fast early, slowing as it climbs — to read as
    // "working" rather than "frozen". Re-armed whenever `step` advances; the
    // segment flipping to is-complete is the real "snap to done".
    const [activeFill, setActiveFill] = useState(0);
    // A step that runs past this reads as "stuck" — the eased fill has long
    // since flattened near its cap. Show a brief reassurance line.
    const [slow, setSlow] = useState(false);
    useEffect(() => {
        setActiveFill(0);
        setSlow(false);
        const start = performance.now();
        const id = window.setInterval(() => {
            const elapsed = performance.now() - start;
            setActiveFill(easedStepProgress(elapsed, PROGRESS_TAU_MS));
            if (elapsed > SLOW_STEP_HINT_MS) setSlow(true);
        }, 150);
        return () => window.clearInterval(id);
    }, [step]);

    return (
        <div className="deploy-progress" role="status" aria-live="polite">
            <div className="progress-meta">
                <span>{`Step ${stepNumber} of ${steps.length}`}</span>
                <span>{currentStep.label}</span>
            </div>
            <div
                className="progress-bar"
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={steps.length}
                aria-valuenow={stepNumber}
                aria-valuetext={`${currentStep.label}: ${status}`}
            >
                {steps.map((s, index) => (
                    <span
                        key={s.id}
                        className={[
                            "progress-segment",
                            index < step ? "is-complete" : "",
                            index === step ? "is-active" : "",
                        ]
                            .filter(Boolean)
                            .join(" ")}
                        aria-hidden="true"
                    >
                        {index === step && (
                            <span
                                className="progress-segment-fill"
                                style={{ width: `${Math.round(activeFill * 100)}%` }}
                            />
                        )}
                    </span>
                ))}
            </div>
            <div className="status">{status}</div>
            {needsPhone && (
                <div className="progress-phone-hint" role="status">
                    📱 Check your phone — approve this step to continue.
                </div>
            )}
            {slow && !needsPhone && (
                <div className="progress-slow-hint" role="status">
                    Still working — this can take a moment.
                </div>
            )}
        </div>
    );
}

function NavTab({
    active,
    onClick,
    icon,
    label,
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
}) {
    return (
        <button
            type="button"
            className={`nav-tab ${active ? "is-active" : ""}`}
            onClick={onClick}
            aria-pressed={active}
        >
            {icon}
            <span className="nav-tab-label">{label}</span>
        </button>
    );
}

// The eject ladder's UI: all three modes are always listed with the current
// one marked. Descriptions signal direction — downward hops are exact
// conversions, upward hops revert and discard — and the confirm dialog
// remains the consent step for any switch that loses edits.
const MODE_NAMES: Record<EditorMode, string> = {
    blocks: "Simple",
    markdown: "Markdown",
    html: "HTML",
};

function modeDescription(target: EditorMode, current: EditorMode): string {
    if (target === current) {
        return {
            blocks: "Visual editing with menus for layout and style.",
            markdown: "Plain-text editing with the same site design.",
            html: "CodePen-style HTML, CSS & JS panes.",
        }[target];
    }
    switch (target) {
        case "blocks":
            return current === "markdown"
                ? "By converting back to Simple, you will lose changes made in Markdown mode."
                : "By converting back to Simple, you will lose changes made in HTML mode.";
        case "markdown":
            return current === "blocks"
                ? "Text, links, and images convert to Markdown. Image sizing and button styling become plain."
                : "By converting back to Markdown, you will lose changes made in HTML mode.";
        case "html":
            return current === "blocks"
                ? "All simple layouts can be converted to HTML."
                : "All Markdown can be converted to HTML.";
    }
}

function ModeSwitcher({
    mode,
    open,
    onToggle,
    onSelect,
}: {
    mode: EditorMode;
    open: boolean;
    onToggle: () => void;
    onSelect: (target: EditorMode) => void;
}) {
    return (
        <div className="mode-wrap action-item">
            <button
                className="action-btn"
                onClick={onToggle}
                aria-haspopup="menu"
                aria-expanded={open}
                title="Editing mode"
            >
                <CodeIcon />
            </button>
            {open && (
                <div className="mode-menu" role="menu">
                    {(["blocks", "markdown", "html"] as const).map((target) => (
                        <button
                            key={target}
                            onClick={() => onSelect(target)}
                            role="menuitemradio"
                            aria-checked={target === mode}
                            className={target === mode ? "is-active" : ""}
                        >
                            <span className="tmpl-name">
                                {MODE_NAMES[target]}
                                {target === mode && (
                                    <span className="mode-current"> ✓ current</span>
                                )}
                            </span>
                            <span className="tmpl-desc">
                                {modeDescription(target, mode)}
                            </span>
                        </button>
                    ))}
                </div>
            )}
            <span className="action-label" aria-hidden="true">
                Mode
            </span>
        </div>
    );
}

// − / value / + stepper for the base font size (px). Clicking the number swaps
// it for a text input; Enter or blur commits, Escape cancels.
function FontSizeStepper({
    value,
    onChange,
}: {
    value: number;
    onChange: (next: number) => void;
}) {
    const [draft, setDraft] = useState<string | null>(null);
    const clamp = (n: number) => Math.min(40, Math.max(8, Math.round(n)));
    const commit = () => {
        if (draft !== null) {
            const n = parseInt(draft, 10);
            if (!Number.isNaN(n)) onChange(clamp(n));
        }
        setDraft(null);
    };
    return (
        <div className="font-size-row" role="group" aria-label="Font size">
            <button
                onClick={() => onChange(clamp(value - 1))}
                aria-label="Decrease font size"
            >
                −
            </button>
            {draft !== null ? (
                <input
                    autoFocus
                    inputMode="numeric"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") commit();
                        if (e.key === "Escape") setDraft(null);
                    }}
                    aria-label="Font size in pixels"
                />
            ) : (
                <button
                    className="font-size-value"
                    onClick={() => setDraft(String(value))}
                    title="Click to type a size"
                >
                    {value}
                </button>
            )}
            <button
                onClick={() => onChange(clamp(value + 1))}
                aria-label="Increase font size"
            >
                +
            </button>
        </div>
    );
}

// A labelled color-picker row inside the Colors menu. `children` slots extra
// controls between the label and the swatch (e.g. the Text row's Auto reset).
function StyleRow({
    label,
    value,
    onChange,
    children,
}: {
    label: string;
    value: string;
    onChange: (next: string) => void;
    children?: React.ReactNode;
}) {
    return (
        <div className="style-row">
            <span className="style-row-label">{label}</span>
            {children}
            <label
                className="swatch"
                title={`${label}: ${value}`}
                style={{ background: value }}
            >
                <span className="sr-only">{label}</span>
                <input
                    type="color"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    aria-label={`${label} color`}
                />
            </label>
        </div>
    );
}

// In edit mode, text blocks stay directly editable inline (the WYSIWYG core);
// structured blocks (link/button/image) render exactly like the preview and
// open the bottom-sheet property editor on tap.
function BlockView({
    block,
    accentColor,
    editable,
    onUpdate,
    onRemove,
    onEdit,
    uploadStatus,
}: {
    block: Block;
    accentColor: string;
    editable: boolean;
    onUpdate: (next: Block) => void;
    onRemove: () => void;
    onEdit: () => void;
    uploadStatus?: string | null;
}) {
    const linkStyle =
        block.type === "link" && block.variant === "pill"
            ? {
                  background: accentColor,
                  color: siteColors(accentColor).foreground,
              }
            : { color: accentColor };
    const structured = block.type === "link" || block.type === "image";
    return (
        <div className={`block ${editable ? "is-editing" : ""}`}>
            {editable && structured && (
                <button
                    className="block-corner block-edit"
                    onClick={onEdit}
                    aria-label={`Edit ${block.type}`}
                    title="Edit"
                >
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                </button>
            )}
            {editable && (
                <button
                    className="block-corner block-remove"
                    onClick={onRemove}
                    aria-label={`Remove ${block.type}`}
                    title="Remove"
                >
                    ×
                </button>
            )}
            {block.type === "heading" && (
                <Editable
                    tag="h1"
                    value={block.text}
                    onChange={(text) => onUpdate({ ...block, text })}
                    editable={editable}
                    className="site-header"
                    style={{ color: accentColor }}
                    placeholder="Heading"
                />
            )}
            {block.type === "paragraph" && (
                <Editable
                    tag="p"
                    value={block.text}
                    onChange={(text) => onUpdate({ ...block, text })}
                    editable={editable}
                    className="site-paragraph"
                    placeholder="Paragraph text"
                />
            )}
            {block.type === "link" && (
                <p className={`block-link ${block.variant === "pill" ? "is-pill" : ""}`}>
                    {editable ? (
                        <span
                            className="site-link block-tap"
                            style={linkStyle}
                            onClick={onEdit}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && onEdit()}
                        >
                            {block.label || "Link text"}
                        </span>
                    ) : (
                        <a
                            // Same allowlist as the deployed artifact: the
                            // preview runs in the APP origin (which holds the
                            // signer), so a typed javascript: URL must be as
                            // inert here as it is in the artifact.
                            href={validateUrl(block.url)}
                            target="_blank"
                            rel="noopener"
                            className="site-link"
                            style={linkStyle}
                        >
                            {block.label}
                        </a>
                    )}
                </p>
            )}
            {block.type === "image" &&
                (block.url && block.url !== "https://" ? (
                    <img
                        className={`site-image is-${imageSize(block.variant)} is-${imageShape(block)} ${editable ? "block-tap" : ""}`}
                        src={block.url}
                        alt={block.alt}
                        onClick={editable ? onEdit : undefined}
                    />
                ) : editable ? (
                    <div
                        className={`site-image-placeholder is-${imageSize(block.variant)} is-${imageShape(block)} block-tap${uploadStatus ? " is-uploading" : ""}`}
                        onClick={onEdit}
                        role="button"
                        tabIndex={0}
                        aria-busy={uploadStatus ? true : undefined}
                        onKeyDown={(e) => e.key === "Enter" && onEdit()}
                    >
                        {uploadStatus && (
                            <span className="upload-spinner" aria-hidden="true" />
                        )}
                        {uploadStatus ?? "No image yet — tap to edit"}
                    </div>
                ) : null)}
            {block.type === "divider" && <hr className="site-divider" />}
        </div>
    );
}

// Bottom-sheet property editor for structured blocks. Labeled form fields,
// live updates (the page behind reflects edits as you type), Delete as the
// destructive footer action.
function BlockEditSheet({
    block,
    onUpdate,
    onDelete,
    onClose,
    onUpload,
    uploadStatus,
    uploadError,
    maxStoreBytes,
}: {
    block: Block;
    onUpdate: (next: Block) => void;
    onDelete: () => void;
    onClose: () => void;
    /** Fire-and-forget: upload state is owned by App (keyed by block id), so
     * it survives this sheet closing and reopening mid-upload. */
    onUpload: (file: File) => void;
    uploadStatus: string | null;
    uploadError: string | null;
    maxStoreBytes: number;
}) {
    // URL entry is the power-user path — hidden behind a toggle by default.
    const [showUrlField, setShowUrlField] = useState(false);
    const uploading = uploadStatus !== null;
    const hasImage =
        block.type === "image" && !!block.url && block.url !== "https://";
    const kind =
        block.type === "link"
            ? block.variant === "pill"
                ? "Button"
                : "Link"
            : "Image";

    return (
        <div className="sheet-backdrop" onClick={onClose}>
            <div
                className="sheet"
                role="dialog"
                aria-label={`Edit ${kind}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="sheet-title">Edit {kind}</div>
                {block.type === "link" && (
                    <>
                        <label className="sheet-field">
                            <span>Label</span>
                            <input
                                type="text"
                                value={block.label}
                                onChange={(e) =>
                                    onUpdate({ ...block, label: e.target.value })
                                }
                                placeholder={kind === "Button" ? "Button text" : "Link text"}
                            />
                        </label>
                        <label className="sheet-field">
                            <span>URL</span>
                            <input
                                type="url"
                                value={block.url}
                                onChange={(e) =>
                                    onUpdate({ ...block, url: e.target.value })
                                }
                                placeholder="https://"
                            />
                        </label>
                    </>
                )}
                {block.type === "image" && (
                    <>
                        <label
                            className={`sheet-media ${hasImage ? "has-img" : ""}`}
                        >
                            <input
                                type="file"
                                accept="image/*"
                                disabled={uploading}
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = "";
                                    if (file) onUpload(file);
                                }}
                            />
                            {uploading && uploadStatus ? (
                                <div className="sheet-media-empty">
                                    <StepProgress
                                        steps={UPLOAD_STEPS}
                                        step={stepForUploadStatus(uploadStatus)}
                                        status={uploadStatus}
                                    />
                                    <span className="sheet-media-note">
                                        Uploading in the background — close this
                                        and keep editing your page.
                                    </span>
                                </div>
                            ) : hasImage ? (
                                <>
                                    <img src={block.url} alt={block.alt} />
                                    <span
                                        className="sheet-media-chip"
                                        aria-hidden="true"
                                    >
                                        Replace
                                    </span>
                                </>
                            ) : (
                                <div className="sheet-media-empty">
                                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M12 16V4" />
                                        <path d="m6 10 6-6 6 6" />
                                        <path d="M4 20h16" />
                                    </svg>
                                    <span>Tap to add an image</span>
                                    <span className="sheet-media-note">
                                        Optimized automatically — up to{" "}
                                        {MAX_IMAGE_DIMENSION}px,{" "}
                                        {(maxStoreBytes / 1024 / 1024).toFixed(0)} MB
                                    </span>
                                </div>
                            )}
                        </label>
                        {uploadError && (
                            <pre className="image-upload-error">{uploadError}</pre>
                        )}
                        {showUrlField ? (
                            <label className="sheet-field">
                                <span>Image link</span>
                                <input
                                    type="url"
                                    value={block.url}
                                    onChange={(e) =>
                                        onUpdate({ ...block, url: e.target.value })
                                    }
                                    placeholder="https://"
                                    autoFocus
                                />
                            </label>
                        ) : (
                            <button
                                type="button"
                                className="sheet-link-toggle"
                                onClick={() => setShowUrlField(true)}
                            >
                                Use an image link instead
                            </button>
                        )}
                        <label className="sheet-field">
                            <span>Alt text</span>
                            <input
                                type="text"
                                value={block.alt}
                                onChange={(e) =>
                                    onUpdate({ ...block, alt: e.target.value })
                                }
                                placeholder="Describe the image"
                            />
                        </label>
                        <div className="sheet-field">
                            <span>Size</span>
                            <VariantToggle
                                label="Image size"
                                options={[
                                    { value: "small", name: "Small · 256px" },
                                    { value: "medium", name: "Medium · 512px" },
                                    { value: "large", name: "Large · full" },
                                ]}
                                value={imageSize(block.variant)}
                                onChange={(variant) =>
                                    onUpdate({
                                        ...block,
                                        variant: variant as ImageVariant,
                                        // Pin the shape so changing size never
                                        // silently changes corners.
                                        shape: imageShape(block),
                                    })
                                }
                            />
                        </div>
                        <div className="sheet-field">
                            <span>Shape</span>
                            <VariantToggle
                                label="Image shape"
                                options={[
                                    { value: "circle", name: "Circle" },
                                    { value: "rounded", name: "Rounded" },
                                    { value: "square", name: "Square" },
                                ]}
                                value={imageShape(block)}
                                onChange={(shape) =>
                                    onUpdate({
                                        ...block,
                                        shape: shape as ImageShape,
                                    })
                                }
                            />
                        </div>
                    </>
                )}
                <div className="sheet-actions">
                    <button className="sheet-delete" onClick={onDelete}>
                        Delete
                    </button>
                    <button className="sheet-done" onClick={onClose}>
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}

// Tiny segmented control for per-block style variants — what makes every
// template block reproducible by hand (avatar images, button links).
function VariantToggle({
    label,
    options,
    value,
    onChange,
}: {
    label: string;
    options: { value: string; name: string }[];
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <span className="variant-toggle" role="group" aria-label={label}>
            {options.map((opt) => (
                <button
                    key={opt.value}
                    type="button"
                    className={value === opt.value ? "is-active" : ""}
                    aria-pressed={value === opt.value}
                    onClick={() => onChange(opt.value)}
                >
                    {opt.name}
                </button>
            ))}
        </span>
    );
}

// Heuristic hint mapping common DotNS failures to actionable next steps.
// The error strings come from pallet-revive dispatch errors, JSON-serialised
// in submit-and-wait, so they're greppable.


// Inline SVG icons. Lightweight, no dep.
function UndoIcon() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
        </svg>
    );
}
function RedoIcon() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 0 1 15-6.7L21 13" />
        </svg>
    );
}
function PaletteIcon() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2a10 10 0 1 0 0 20c1 0 1.6-.75 1.6-1.7 0-.44-.17-.84-.44-1.13-.26-.29-.43-.68-.43-1.12a1.65 1.65 0 0 1 1.67-1.67h2c3.05 0 5.6-2.5 5.6-5.55C22 6 17.5 2 12 2z" />
            <circle cx="7" cy="11" r="0.5" fill="currentColor" />
            <circle cx="10" cy="7" r="0.5" fill="currentColor" />
            <circle cx="15" cy="7" r="0.5" fill="currentColor" />
        </svg>
    );
}
function CodeIcon() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
        </svg>
    );
}
function BackIcon() {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
        </svg>
    );
}
function CheckIcon({ size = 18 }: { size?: number }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6L9 17l-5-5" />
        </svg>
    );
}
function CopyIcon({ size = 15 }: { size?: number }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    );
}
function PencilIcon() {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" />
        </svg>
    );
}
function EyeIcon() {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}
function RocketIcon() {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
            <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
            <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
            <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
        </svg>
    );
}
