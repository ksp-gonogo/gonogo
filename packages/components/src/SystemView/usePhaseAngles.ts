import { useTelemetry } from "@ksp-gonogo/core";
import {
  canPropagate,
  deriveTrueAnomalyDeg,
  useScetUt,
} from "@ksp-gonogo/sitrep-client";
import { useMemo } from "react";
import { magnitudeOf, magnitudeOr } from "../shared/magnitude";
import type { CelestialBody } from "./useCelestialBodies";

/**
 * Phase angle (deg, in [0, 360)) from each body to the active vessel, keyed by body index.
 *
 * Each object's true longitude is `wrap360(lan + argPe + trueAnomaly)` and the phase angle is `wrap360(bodyLon - vesselLon)`, positive when the body is ahead prograde, matching `hohmannPhaseAngle`. That longitude is exact only for coplanar orbits, the transfer window's own assumption.
 *
 * Returns a stable empty map when there is no vessel orbit, the orbit is hyperbolic, SCET is unknown, or the provider will not answer for it.
 */
export function usePhaseAngles(
  bodies: readonly CelestialBody[],
): Map<number, number> {
  // A position relationship, so only a current reading or a model will do; a stale one would draw the window the craft was in.
  const orbitReading = useTelemetry("vessel.orbit");
  // The observation overlaid by what the conic moved (the phase); `reckoning.value` alone is not an orbit.
  const orbitObserved =
    orbitReading.state === "observed" || orbitReading.state === "stale"
      ? orbitReading.value
      : undefined;
  const orbit =
    orbitObserved === undefined
      ? undefined
      : orbitReading.reckoning.status === "available"
        ? { ...orbitObserved, ...orbitReading.reckoning.value }
        : orbitObserved;
  // Unwrapped at the read; `magnitudeOf` already answers null for an absent or non-finite reading.
  const ut = magnitudeOf(useScetUt());

  return useMemo(() => {
    if (!orbit) return EMPTY;
    // The provider gate below needs a real instant to put a window to.
    if (ut === null) return EMPTY;
    // The same horizon question SystemView's own solve asks, so scrubbing past an integrator's horizon cannot leave a live highlight without a vessel dot. Shape is not consulted: a position at one instant needs none.
    if (!canPropagate(orbit.horizon, ut, ut).propagatable) return EMPTY;
    // Null for a non-elliptical orbit or a missing element.
    const nu = deriveTrueAnomalyDeg({
      semiMajorAxis: orbit.sma.magnitude,
      eccentricity: orbit.ecc.magnitude,
      meanAnomalyAtEpoch: orbit.meanAnomalyAtEpoch.magnitude,
      epoch: orbit.epoch.magnitude,
      parentGravParameter: orbit.mu.magnitude,
      ut,
    });
    if (nu === null) return EMPTY;
    // LAN and argPe default to 0, the same coalescing the widget uses to draw the vessel's orbit.
    const vesselLon = wrap360(
      magnitudeOr(orbit.lan, 0) + magnitudeOr(orbit.argPe, 0) + nu,
    );

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

// Stable identity so a memoising consumer does not churn while there is no phase angle.
const EMPTY: Map<number, number> = new Map();
