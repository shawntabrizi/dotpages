// Markdown mode: blocks serialize DOWN to markdown losslessly (the one-way
// "eject" ladder — blocks → markdown → html), and markdown renders through
// the same document shell as the simple editor, so theme controls
// (accent/bg/font) keep working.

import { marked } from "marked";
import {
    assembleDocument,
    escapeHtml,
    shellCss,
    wrapMain,
    type DocumentParts,
    type PageTheme,
    type SiteContent,
} from "./template.ts";

// Downgrade of the block model. Content converts exactly, but markdown can't
// express image sizing or pill-button styling, so those blocks become a plain
// image and link.
export function blocksToMarkdown(content: SiteContent): string {
    const parts: string[] = [];
    for (const b of content.blocks) {
        switch (b.type) {
            case "heading":
                parts.push(`# ${b.text}`);
                break;
            case "paragraph":
                parts.push(b.text);
                break;
            case "link":
                parts.push(`[${b.label}](${b.url})`);
                break;
            case "image":
                parts.push(`![${b.alt}](${b.url})`);
                break;
            case "divider":
                parts.push("---");
                break;
        }
    }
    return parts.join("\n\n") + "\n";
}

// <title> comes from the first ATX heading, mirroring renderHtmlParts'
// first-heading-block fallback.
function titleFromMarkdown(markdown: string): string {
    const m = markdown.match(/^#{1,6}\s+(.+)$/m);
    return m ? m[1].trim() : "hello";
}

export function renderMarkdownParts(markdown: string, theme: PageTheme): DocumentParts {
    const body = marked.parse(markdown, { async: false });
    return {
        title: escapeHtml(titleFromMarkdown(markdown)),
        css: shellCss(theme, ["markdown"]),
        bodyHtml: wrapMain(body),
    };
}

export function renderMarkdownHtml(markdown: string, theme: PageTheme): string {
    return assembleDocument(renderMarkdownParts(markdown, theme));
}
