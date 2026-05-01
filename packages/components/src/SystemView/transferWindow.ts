/**
 * Hohmann transfer-window math.
 *
 * For a coplanar Hohmann transfer between two bodies orbiting the same parent
 * (or a vessel in orbit around the same parent as the target body), the
 * ideal departure phase angle is:
 *
 *   θ_ideal = 180° × (1 − ((rA + rB) / (2 rB))^1.5)
 *
 * where rA is the spacecraft's orbital radius (semi-major axis around the
 * shared parent) and rB is the target's. Positive θ means the target should
 * be that many degrees AHEAD of the spacecraft at burn time; negative means
 * behind. Outer-target transfers (rB > rA) → positive θ; inner-target
 * transfers (rB < rA) → negative.
 *
 * Sanity:
 *   Earth → Mars  (rA=1 AU, rB=1.524) → +44.4°  ✓
 *   Earth → Venus (rA=1, rB=0.723)    → −54.2°  ✓
 */

export function hohmannPhaseAngle(rA: number, rB: number): number {
  if (!Number.isFinite(rA) || !Number.isFinite(rB) || rA <= 0 || rB <= 0) {
    return Number.NaN;
  }
  const ratio = ((rA + rB) / (2 * rB)) ** 1.5;
  return 180 * (1 - ratio);
}

/**
 * Smallest signed angular distance from `current` to `target`, wrapped to
 * (−180, 180]. Used to decide how close the live phase angle is to the
 * Hohmann ideal — the wrap matters because Telemachus reports phase angles
 * in [0, 360) and we want to handle the seam.
 */
export function angleDelta(current: number, target: number): number {
  let d = (current - target) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export type TransferStatus = "go" | "soon" | "off";

/**
 * Highlight tier for a body's phase-angle readout:
 *   - "go"   when within ±2° of the Hohmann ideal
 *   - "soon" when within ±10°
 *   - "off"  otherwise
 *
 * Two thresholds rather than a binary green/none so the diagram telegraphs
 * the "approaching window" phase as well as "burn now". 10° is the typical
 * arming window in a real-time KSP playthrough where warp + reaction
 * latency matter.
 */
export function transferStatus(deltaDeg: number): TransferStatus {
  const a = Math.abs(deltaDeg);
  if (a < 2) return "go";
  if (a < 10) return "soon";
  return "off";
}
