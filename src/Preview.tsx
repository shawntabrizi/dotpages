import { useMemo } from "react";
import { renderHtml, type SiteContent } from "./template.ts";

// `srcdoc` sandboxes the generated HTML inside an iframe, so user-entered
// CSS/font/URL choices can't reach back into the editor. The iframe shows
// EXACTLY what gets uploaded — same bytes, byte-for-byte.
export function Preview({ content }: { content: SiteContent }) {
    const html = useMemo(() => renderHtml(content), [content]);
    return (
        <iframe
            className="preview"
            title="Preview"
            srcDoc={html}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
        />
    );
}
