import { useTelemetry } from "@ksp-gonogo/core";
import { useViewUt } from "@ksp-gonogo/sitrep-client";
import { useMemo } from "react";
import { deriveTrueAnomalyDeg } from "./bodyDerivations";
import type { CelestialBody } from "./useCelestialBodies";

/**
 * Phase angle (deg, in [0, 360)) from each body to the active vessel, keyed by
 * body index — the input the AlmanacPanel's transfer-window readout and
 * SystemDiagram's per-body label consume.
 *
 * This rode Telemachus's derived `b.o.phaseAngle[i]` key, deleted in the
 * Telemachus removal. It's reconstructed CLIENT-SIDE here: each object's true
 * longitude is `L = wrap360(Ω + ω + ν)` (LAN + argPe + true anomaly), and the
 * phase angle is `wrap360(bodyLon − vesselLon)`. Positive = the body is ahead of
 * the vessel in the prograde direction, matching `hohmannPhaseAngle`'s "+ =
 * target ahead" convention so `angleDelta(live, ideal)` lines up.
 *
 * The bodies arrive with their elements already on `CelestialBody` (LAN + argPe
 * off the wire, `trueAnomaly` derived at the view-UT). The vessel side reads the
 * `vessel.orbit` Topic and solves its true anomaly at the same view-UT through
 * the shared Kepler path (`deriveTrueAnomalyDeg`) — no second solver.
 *
 * `L = Ω + ω + ν` is the exact in-plane longitude only for COPLANAR orbits; an
 * inclined body picks up a small projection error. That's already the
 * transfer-window's own assumption — the consumer only acts on the result when
 * the vessel and the bodies share a parent — and KSP inclinations are low, so
 * the standard approximation is used deliberately rather than a full
 * reference-plane projection.
 *
 * Degrades to a stable empty map (no consumer churn, treated as "no highlight")
 * when there's no vessel orbit yet, the orbit is hyperbolic (ecc ≥ 1, no valid
 * anomaly), or the view-UT isn't known.
 */
export function usePhaseAngles(
  bodies: readonly CelestialBody[],
): Map<number, number> {
  const orbit = useTelemetry("vessel.orbit");
  const ut = useViewUt();

  return useMemo(() => {
    if (!orbit) return EMPTY;
    // Vessel true anomaly at the view-UT via the shared solver (null for a
    // parabolic/hyperbolic orbit or a missing element — no phase reference).
    const nu = deriveTrueAnomalyDeg({
      semiMajorAxis: orbit.sma,
      eccentricity: orbit.ecc,
      meanAnomalyAtEpoch: orbit.meanAnomalyAtEpoch,
      epoch: orbit.epoch,
      parentGravParameter: orbit.mu,
      ut,
    });
    if (nu === null) return EMPTY;
    // LAN/argPe default to 0 (equatorial / circular) — the same coalescing the
    // widget uses when it draws the vessel's own orbit.
    const vesselLon = wrap360((orbit.lan ?? 0) + (orbit.argPe ?? 0) + nu);

    const out = new Map<number, number>();
    for (const b of bodies) {
      const bodyLon = trueLongitudeDeg(
        b.lan,
        b.argumentOfPeriapsis,
        b.trueAnomaly,
      );
      if (bodyLon === null) continue; // no orbit (root star) or missing element
      out.set(b.index, wrap360(bodyLon - vesselLon));
    }
    return out.size > 0 ? out : EMPTY;
  }, [bodies, orbit, ut]);
}

/** True longitude `wrap360(lan + argPe + trueAnomaly)`, degrees; null if any input is missing. */
function trueLongitudeDeg(
  lan: number | null,
  argPe: number | null,
  trueAnomaly: number | null,
): number | null {
  if (
    lan === null ||
    argPe === null ||
    trueAnomaly === null ||
    !Number.isFinite(lan) ||
    !Number.isFinite(argPe) ||
    !Number.isFinite(trueAnomaly)
  ) {
    return null;
  }
  return wrap360(lan + argPe + trueAnomaly);
}

function wrap360(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

// Stable identity so a consumer memoising on the returned map doesn't churn
// while there's no live phase angle.
const EMPTY: Map<number, number> = new Map();
