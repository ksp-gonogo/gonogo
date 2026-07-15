/**
 * The minimal, dispatch-time-only shape `computeUplinkPulse` reads off a
 * `system.uplink.pending` entry (`Sitrep.Contract.PendingUplink`) — never
 * anything execution/result-shaped, matching that contract's own
 * prediction-only invariant (see `mod/Sitrep.Contract/UplinkPending.cs`'s
 * class doc). `dispatchedAt`/`oneWaySeconds` are both TrueNow ground-clock
 * quantities frozen at dispatch time — compare against `useUtNow()`, never
 * the delayed `useViewUt()` (see `use-stream.ts`'s `useLatestValue` doc for
 * why: sampling either through the delayed frame makes the overlay appear,
 * and clear, a whole one-way-delay late).
 */
export interface PendingPulseEntry {
  dispatchedAt: number;
  oneWaySeconds: number;
}

export type UplinkPulseLeg = "outbound" | "return";

export interface UplinkPulse {
  /** `"outbound"` = Vantage -> target (the first `oneWaySeconds`); `"return"` = target -> Vantage (the second). */
  leg: UplinkPulseLeg;
  /** 0..1 fraction of progress ALONG the current leg (0 = leg start, 1 = leg end). */
  progress: number;
  /** 0..1 render opacity — fades over the final `FADE_FRACTION` of the round trip so a pulse doesn't just vanish. */
  opacity: number;
}

/** Fraction of the total round-trip (`2 * oneWaySeconds`) over which opacity ramps down before the pulse expires. */
const FADE_FRACTION = 0.1;
/** Opacity floor at the very end of the fade, never fully invisible mid-ramp. */
const MIN_OPACITY = 0.15;

/**
 * Predicts a `PendingUplink` entry's animation state at `utNow` (the
 * TrueNow ground-clock estimate, `useUtNow()`) — an outbound pulse from
 * dispatch to `dispatchedAt + oneWaySeconds`, then a return pulse to
 * `dispatchedAt + 2*oneWaySeconds`. Matches the boundary convention
 * `KosTerminal`'s already-shipped in-transit strip uses
 * (`reachUt`/`replyUt`), just expressed as a continuous 0..1 progress
 * fraction per leg instead of a countdown string.
 *
 * `null`:
 * - before dispatch (defensive — shouldn't happen, the queue is
 *   dispatch-time-only),
 * - once the round trip has fully elapsed (a client-side safety net;
 *   the SERVER is the actual pruning authority — an entry disappearing from
 *   a later `system.uplink.pending` snapshot is the real "done" signal, this
 *   is just a belt-and-suspenders local expiry so a delayed prune never
 *   leaves a stale pulse glued to the diagram),
 * - for a non-finite or non-positive `oneWaySeconds` (no meaningful leg
 *   length to animate against).
 *
 * Never reads or infers anything about vessel-side receipt/execution —
 * pure dispatch-time arithmetic, honouring the contract's prediction-only
 * invariant.
 */
export function computeUplinkPulse(
  entry: PendingPulseEntry,
  utNow: number,
): UplinkPulse | null {
  const { dispatchedAt, oneWaySeconds } = entry;
  if (!Number.isFinite(oneWaySeconds) || oneWaySeconds <= 0) return null;
  if (!Number.isFinite(dispatchedAt) || !Number.isFinite(utNow)) return null;

  const elapsed = utNow - dispatchedAt;
  if (elapsed < 0) return null;
  const total = oneWaySeconds * 2;
  if (elapsed > total) return null;

  const leg: UplinkPulseLeg = elapsed <= oneWaySeconds ? "outbound" : "return";
  const progress =
    leg === "outbound"
      ? elapsed / oneWaySeconds
      : (elapsed - oneWaySeconds) / oneWaySeconds;

  const remainingFraction = (total - elapsed) / total;
  const opacity =
    remainingFraction < FADE_FRACTION
      ? MIN_OPACITY + (1 - MIN_OPACITY) * (remainingFraction / FADE_FRACTION)
      : 1;

  return { leg, progress, opacity };
}
