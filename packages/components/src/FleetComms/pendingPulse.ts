import { magnitudeOf, type Quantityish } from "../shared/magnitude";

/**
 * The dispatch-time-only shape `computeUplinkPulse` reads off a
 * `system.uplink.pending` entry. Both fields are TrueNow ground-clock
 * quantities: compare against `useUtNow()`, never the delayed `useViewUt()`,
 * or the overlay appears and clears a whole one-way delay late.
 */
export interface PendingPulseEntry {
  dispatchedAt: Quantityish;
  oneWaySeconds: Quantityish;
}

export type UplinkPulseLeg = "outbound" | "return";

export interface UplinkPulse {
  /** `"outbound"` = Vantage -> target (the first `oneWaySeconds`); `"return"` = target -> Vantage (the second). */
  leg: UplinkPulseLeg;
  /** 0..1 fraction of progress ALONG the current leg (0 = leg start, 1 = leg end). */
  progress: number;
  /** 0..1 render opacity, fades over the final `FADE_FRACTION` of the round trip so a pulse doesn't just vanish. */
  opacity: number;
}

/** Fraction of the total round-trip (`2 * oneWaySeconds`) over which opacity ramps down before the pulse expires. */
const FADE_FRACTION = 0.1;
/** Opacity floor at the very end of the fade, never fully invisible mid-ramp. */
const MIN_OPACITY = 0.15;

/**
 * A `PendingUplink` entry's animation state at `utNow` (TrueNow): an outbound
 * leg to `dispatchedAt + oneWaySeconds`, then a return leg to
 * `dispatchedAt + 2*oneWaySeconds`, each as 0..1 progress. Pure dispatch-time
 * arithmetic, never anything about vessel-side receipt.
 *
 * `null` before dispatch, once the round trip has elapsed (a local expiry; the
 * server's snapshot is the pruning authority), and for a non-positive
 * `oneWaySeconds`.
 */
export function computeUplinkPulse(
  entry: PendingPulseEntry,
  utNow: number,
): UplinkPulse | null {
  // An animation, so it works in raw seconds.
  const dispatchedAt = magnitudeOf(entry.dispatchedAt);
  const oneWaySeconds = magnitudeOf(entry.oneWaySeconds);
  if (oneWaySeconds === null || oneWaySeconds <= 0) return null;
  if (dispatchedAt === null || !Number.isFinite(utNow)) return null;

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
