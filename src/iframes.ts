// Some hosts forbid iframes outright — Polkadot Mobile's Android webview
// throws "iframe creation is not allowed", which would crash the landing page
// the moment React rendered the first thumbnail. Probe the capability once
// (creation AND attach, since hosts may hook either) so the thumbnails and
// the preview frame can degrade instead of dying in an error boundary.

// Success is cached forever; failure is RETRIED (at most every few seconds) —
// the guard is likely phase-sensitive (the landing creates iframes at boot),
// and a permanent false verdict from one early throw would downgrade the whole
// session needlessly.
let allowed = false;
let lastFailureAt = 0;
const RETRY_MS = 5_000;

export function iframesAllowed(): boolean {
    if (allowed) return true;
    const now = Date.now();
    if (lastFailureAt && now - lastFailureAt < RETRY_MS) return false;
    try {
        const el = document.createElement("iframe");
        el.style.display = "none";
        document.body.appendChild(el);
        el.remove();
        allowed = true;
    } catch {
        lastFailureAt = now;
    }
    return allowed;
}
