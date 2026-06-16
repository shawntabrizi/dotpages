// Within-step progress easing for StepProgress's active segment.
//
// The slow step in an upload/deploy is the broadcast / in-block wait, and the
// chain layer exposes NO sub-progress for it. So we model EXPECTED progress
// against a typical step duration: an eased curve that moves fast early, then
// visibly slows as it climbs — so a step taking longer than usual reads as
// "still working, but slow" rather than "frozen".
//
// Two honesty guarantees:
//   1. It NEVER reaches 1 on its own (capped below 100%). The caller snaps to
//      done only when the step ACTUALLY advances, so the bar can't claim
//      completion the work hasn't reached.
//   2. The real completion/timeout is enforced elsewhere. This is purely a
//      liveness cue, not a meter.

/** Time constant: the curve reaches ~63% of its cap at TAU. Tuned to the
 *  typical broadcast/in-block window (~6-12s). */
export const PROGRESS_TAU_MS = 9_000;

/** Hard ceiling the curve asymptotes toward but never reaches — leaves visible
 *  headroom so the bar is never full until the caller snaps it on real
 *  completion. */
export const PROGRESS_CAP = 0.92;

/**
 * Eased, asymptotic progress fraction in [0, PROGRESS_CAP).
 *
 * `elapsedMs` is time since the current step became active. Returns a value
 * that rises monotonically, fast at first then slowing, and is strictly less
 * than `cap` for any finite input.
 */
export function easedStepProgress(
  elapsedMs: number,
  tauMs: number = PROGRESS_TAU_MS,
  cap: number = PROGRESS_CAP,
): number {
  if (!(elapsedMs > 0)) return 0; // also catches NaN
  return cap * (1 - Math.exp(-elapsedMs / tauMs));
}
