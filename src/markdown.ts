// Markdown mode: blocks serialize DOWN to markdown losslessly (the one-way
// "eject" ladder — blocks → markdown → html), and markdown renders through
// the same document shell as the simple editor, so theme controls
// (accent/bg/font) keep working.

import { marked } from "marked";
import {
    assembleDocument,
    escapeHtml,
    shellCss,
    validateUrl,
    wrapMain,
    type DocumentParts,
    type PageTheme,
    type SiteContent,
} from "./template.ts";

// Blocks render text literally (escapeHtml in template.ts), but markdown
// passes raw HTML through live. Backslash-escape `<` (HTML tags) and `&`
// (entity references) so converted text keeps meaning what it meant in
// blocks mode; backslash escapes stay readable in the markdown editor.
const escapeMarkdownText = (s: string): string => s.replace(/[<&]/g, (c) => `\\${c}`);

// Link labels / image alt additionally escape square brackets so the text
// can't terminate or nest the surrounding link structure.
const escapeMarkdownLabel = (s: string): string =>
    escapeMarkdownText(s).replace(/[[\]]/g, (c) => `\\${c}`);

// URLs go through the SAME allowlist the renderers use, so a javascript:
// link that rendered inert ("#") in blocks mode stays inert after the mode
// switch instead of becoming an active href. CommonMark's <...> destination
// form tolerates spaces and parentheses; literal angle brackets inside the
// URL are percent-encoded since that form can't contain them.
const markdownUrl = (raw: string): string =>
    `<${validateUrl(raw).replace(/</g, "%3C").replace(/>/g, "%3E")}>`;

// Downgrade of the block model. Content converts exactly, but markdown can't
// express image sizing or pill-button styling, so those blocks become a plain
// image and link.
export function blocksToMarkdown(content: SiteContent): string {
    const parts: string[] = [];
    for (const b of content.blocks) {
        switch (b.type) {
            case "heading":
                parts.push(`# ${escapeMarkdownText(b.text)}`);
                break;
            case "paragraph":
                parts.push(escapeMarkdownText(b.text));
                break;
            case "link":
                parts.push(`[${escapeMarkdownLabel(b.label)}](${markdownUrl(b.url)})`);
                break;
            case "image":
                parts.push(`![${escapeMarkdownLabel(b.alt)}](${markdownUrl(b.url)})`);
                break;
            case "divider":
                parts.push("---");
                break;
        }
    }
    return `${parts.join("\n\n")}\n`;
}

// <title> comes from the first ATX heading, mirroring renderHtmlParts'
// first-heading-block fallback.
function titleFromMarkdown(markdown: string): string {
    const m = markdown.match(/^#{1,6}\s+(.+)$/m);
    return m ? m[1].trim() : "hello";
}

// `interactive` is threaded to wrapMain: false for the editor's live preview
// iframe (inert credit), true (default) for the deployed artifact.
export function renderMarkdownParts(
    markdown: string,
    theme: PageTheme,
    interactive = true,
): DocumentParts {
    const body = marked.parse(markdown, { async: false });
    return {
        title: escapeHtml(titleFromMarkdown(markdown)),
        css: shellCss(theme, ["markdown"]),
        bodyHtml: wrapMain(body, interactive),
    };
}

export function renderMarkdownHtml(markdown: string, theme: PageTheme, interactive = true): string {
    return assembleDocument(renderMarkdownParts(markdown, theme, interactive));
}
