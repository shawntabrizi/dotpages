import { useEffect } from "react";
import { createThemeProvider } from "@novasamatech/host-api-wrapper";

// Host theme bridge. The 0.8.x host pushes a theme payload of the shape
// `{ name: { tag, value }, variant: "Light" | "Dark" }` over the host-api
// transport; we only care about the light/dark variant. We mirror it onto a
// `data-theme="light|dark"` attribute on <html>, and the CSS custom-property
// tokens in App.css do the rest. Standalone (no host) the subscription simply
// never fires, so the document keeps its default dark look.

type ThemeVariant = "light" | "dark";

function applyTheme(variant: ThemeVariant) {
    document.documentElement.setAttribute("data-theme", variant);
    // Keep the browser UI (status bar, etc.) in step with the page surface.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
        meta.setAttribute("content", variant === "light" ? "#ffffff" : "#0b0d12");
    }
}

// Subscribe once to the host theme and toggle the document attribute. Returns
// a teardown that closes the subscription. Defaults to dark when standalone.
export function useHostTheme(): void {
    useEffect(() => {
        // Default before the host answers (or forever, standalone).
        applyTheme("dark");

        let sub: { unsubscribe?: () => void } | void;
        try {
            const provider = createThemeProvider();
            sub = provider.subscribeTheme((theme) => {
                // `theme.variant` is "Light" | "Dark" in 0.8.x. Be defensive in
                // case a future payload nests or renames it.
                const raw =
                    (theme && typeof theme === "object" && "variant" in theme
                        ? (theme as { variant?: unknown }).variant
                        : theme) ?? "Dark";
                const variant: ThemeVariant =
                    String(raw).toLowerCase() === "light" ? "light" : "dark";
                applyTheme(variant);
            });
        } catch {
            // No host transport (standalone) — stay on the default dark theme.
        }

        return () => {
            try {
                sub?.unsubscribe?.();
            } catch {
                // best-effort teardown
            }
        };
    }, []);
}
