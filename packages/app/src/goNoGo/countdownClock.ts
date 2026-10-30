/**
 * The instant, on this screen's own clock, at which a countdown that has
 * `remainingMs` left reaches T-0. A station derives it on the frame's arrival,
 * so its display no longer depends on how far its clock sits from the main
 * screen's.
 */
export function localDeadline(remainingMs: number, nowMs: number): number {
  return nowMs + remainingMs;
}

/** Seconds left until `t0Ms` on this screen's own clock, never below zero. */
export function secondsUntil(t0Ms: number, nowMs: number): number {
  return Math.max(0, (t0Ms - nowMs) / 1000);
}
