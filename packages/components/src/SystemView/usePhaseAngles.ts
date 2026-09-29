import { useTelemetry } from "@ksp-gonogo/core";
import {
  canPropagate,
  deriveTrueAnomalyDeg,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import {
  deriveReading,
  type Reading,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import { magnitudeOf, magnitudeOr } from "../shared/magnitude";
import { normalizePhaseAngle } from "./transferWindow";
import type { CelestialBody } from "./useCelestialBodies";

/**
 * Phase angle (deg, in [0, 360)) from each body to the active vessel, keyed by body index.
 *
 * Each object's true longitude is `wrap360(lan + argPe + trueAnomaly)` and the phase angle is `wrap360(bodyLon - vesselLon)`, positive when the body is ahead prograde, matching `hohmannPhaseAngle`. That longitude is exact only for coplanar orbits, the transfer window's own assumption.
 *
 * Returns a stable empty map when there is no vessel orbit, the orbit is hyperbolic, the received edge is unknown, or the provider will not answer for it.
 */
export function usePhaseAngles(
  bodies: readonly CelestialBody[],
): Map<number, number> {
  // A position relationship, so only a current reading or a model will do; a held one would draw the window the craft was in.
  const orbitReading = useTelemetry("vessel.orbit");
  // The observation overlaid by what the conic moved (the phase); `reckoning.value` alone is not an orbit.
  const orbitObserved =
    orbitReading.state === "observed" || orbitReading.state === "held"
      ? orbitReading.value
      : undefined;
  const orbit =
    orbitObserved === undefined
      ? undefined
      : orbitReading.reckoning.status === "available"
        ? { ...orbitObserved, ...orbitReading.reckoning.value }
        : orbitObserved;
  // Unwrapped at the read; `magnitudeOf` already answers null for an absent or non-finite reading.
  const ut = magnitudeOf(useViewUt());

  return useMemo(() => {
    if (!orbit) return EMPTY;
    // The provider gate below needs a real instant to put a window to.
    if (ut === null) return EMPTY;
    // The same horizon question SystemView's own solve asks, so scrubbing past an integrator's horizon cannot leave a live highlight without a vessel dot. Shape is not consulted: a position at one instant needs none.
    if (!canPropagate(orbit.horizon, ut, ut).propagatable) return EMPTY;
    const vesselLon = vesselLongitudeAt(orbit, ut);
    if (vesselLon === null) return EMPTY;

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

type OrbitElements = NonNullable<Parameters<typeof vesselLongitudeAt>[0]>;

/** The vessel's true longitude at `ut`, degrees; null for a non-elliptical orbit or a missing element. */
function vesselLongitudeAt(
  orbit: {
    sma: Value<"m">;
    ecc: Value<"1">;
    meanAnomalyAtEpoch: Value<"rad">;
    epoch: Value<"ut">;
    mu: Value<"m³/s²">;
    lan?: Value<"°"> | null;
    argPe?: Value<"°"> | null;
  },
  ut: number,
): number | null {
  const nu = deriveTrueAnomalyDeg({
    semiMajorAxis: orbit.sma.magnitude,
    eccentricity: orbit.ecc.magnitude,
    meanAnomalyAtEpoch: orbit.meanAnomalyAtEpoch.magnitude,
    epoch: orbit.epoch.magnitude,
    parentGravParameter: orbit.mu.magnitude,
    ut,
  });
  if (nu === null) return null;
  // LAN and argPe default to 0, the same coalescing the widget uses to draw the vessel's orbit.
  return wrap360(magnitudeOr(orbit.lan, 0) + magnitudeOr(orbit.argPe, 0) + nu);
}

/**
 * One body's phase angle as a Reading: observed at the received edge `ut`, and,
 * where the vessel's conic reckons past it, both objects advanced to the
 * instant the reckoning is for. Degrees in (-180, 180].
 */
export function usePhaseAngleReading(
  body: CelestialBody | null,
  bodies: readonly CelestialBody[],
  ut: number | undefined,
): Reading<Value<"°">> | undefined {
  const orbitReading = useTelemetry("vessel.orbit");
  return useMemo(() => {
    if (body === null || ut === undefined) return undefined;
    const parentMu =
      bodies.find((b) => b.name === body.referenceBody)?.gravParameter ?? null;
    const reading = deriveReading(
      orbitReading,
      (orbit) => phaseAngle(orbit, ut, body.trueAnomaly, body),
      (orbit, atUt) => {
        // `deriveTrueAnomalyDeg` is plain-number geometry, so the reckoning's instant unwraps here.
        const at = atUt.magnitude;
        return phaseAngle(
          orbit,
          at,
          bodyTrueAnomalyAt(body, parentMu, at),
          body,
        );
      },
    );
    return reading.value === undefined ? undefined : reading;
  }, [body, bodies, orbitReading, ut]);
}

function phaseAngle(
  orbit: OrbitElements,
  ut: number,
  bodyTrueAnomaly: number | null,
  body: CelestialBody,
): Value<"°"> | undefined {
  const vesselLon = vesselLongitudeAt(orbit, ut);
  const bodyLon = trueLongitudeDeg(
    body.lan,
    body.argumentOfPeriapsis,
    bodyTrueAnomaly,
  );
  if (vesselLon === null || bodyLon === null) return undefined;
  return value("°", normalizePhaseAngle(bodyLon - vesselLon));
}

function bodyTrueAnomalyAt(
  body: CelestialBody,
  parentGravParameter: number | null,
  ut: number,
): number | null {
  return deriveTrueAnomalyDeg({
    semiMajorAxis: body.semiMajorAxis,
    eccentricity: body.eccentricity,
    meanAnomalyAtEpoch: body.meanAnomalyAtEpoch,
    epoch: body.epoch,
    parentGravParameter,
    ut,
  });
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
