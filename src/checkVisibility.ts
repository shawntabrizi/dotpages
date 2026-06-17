// Minimum on-screen time for the deploy panel's "Checking…" state, so a check
// that resolves within the click's microtask flush (instant reject on a wedged
// socket, or a cached result) still paints visible feedback.
export const MIN_CHECK_VISIBLE_MS = 400;

/** How long to keep "Checking…" up after a check resolves, given how long it
 *  ran. Faster than the floor → the remaining time; at/over it → 0. */
export function checkBusyClearDelay(elapsedMs: number): number {
    return Math.max(0, MIN_CHECK_VISIBLE_MS - elapsedMs);
}
