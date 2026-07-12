import { useTelemetry } from "@ksp-gonogo/core";
import { useViewUt } from "@ksp-gonogo/sitrep-client";
import type { BodyEntry } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import {
  deriveEscapeVelocity,
  deriveHillSphere,
  deriveMass,
  derivePeriod,
  deriveSurfaceGravityG,
  deriveTrueAnomalyDeg,
} from "./bodyDerivations";

/**
 * The celestial-body tree, read off the mod's `system.bodies` stream Topic and
 * enriched with the almanac values the wire deliberately drops (see
 * `bodyDerivations.ts` — mass, surface gravity, escape velocity, orbital
 * period, hill sphere and the live true anomaly are all reconstructed here from
 * `gravParameter` + `radius` + the orbit).
 *
 * This replaced the old Telemachus `b.*[i]` indexed-bucket fan-out (which read
 * `getDataSource("data")` directly — a source deleted in the Telemachus
 * removal, which is why the body list went empty everywhere: SystemView,
 * TargetPicker's Bodies tab, OrbitView's body overlay).
 *
 * The derived `trueAnomaly` tracks the SDK view-UT, so bodies advance along
 * their orbits on the widget's telemetry-driven re-renders — the same cadence
 * the old live `b.o.trueAnomaly[i]` read ticked at.
 */

export interface BodyAtmosphere {
  /** Atmosphere height, metres. */
  depth: number | null;
  /** Whether the atmosphere is breathable / oxygenated. */
  hasOxygen: boolean | null;
  /** Sea-level pressure, kPa. */
  seaLevelPressure: number | null;
}

export interface CelestialBody {
  index: number;
  name: string | null;
  referenceBody: string | null;
  radius: number | null;
  /** Sphere-of-influence radius, metres. */
  soi: number | null;
  /** Standard gravitational parameter μ = G·M, m³/s² — the compute primitive. */
  gravParameter: number | null;
  // ── Orbit (null for the root star) ──────────────────────────────────────
  semiMajorAxis: number | null;
  eccentricity: number | null;
  inclination: number | null;
  lan: number | null;
  argumentOfPeriapsis: number | null;
  meanAnomalyAtEpoch: number | null;
  epoch: number | null;
  // ── Derived orbit values (from the elements + view-UT) ──────────────────
  /** Orbital period, seconds — derived `2π√(a³/μ_parent)`. */
  period: number | null;
  /** True anomaly, degrees in [0, 360), at the current view-UT — derived. */
  trueAnomaly: number | null;
  // ── Derived body properties (from μ + radius) ───────────────────────────
  /** Mass, kg — derived `μ/G`. */
  mass: number | null;
  /** Surface gravity in g — derived `μ/r²/g₀`. */
  geeASL: number | null;
  /** Escape velocity, m/s — derived `√(2μ/r)`. */
  escapeVelocity: number | null;
  /** Hill-sphere radius, metres — derived from the orbit + masses. */
  hillSphere: number | null;
  // ── Almanac (on the wire) ───────────────────────────────────────────────
  rotationPeriod: number | null;
  tidallyLocked: boolean | null;
  /** Whether the body rotates — derived (rotationPeriod finite and non-zero). */
  rotates: boolean | null;
  hasOcean: boolean | null;
  description: string | null;
  /** Atmosphere descriptor; null when the body is airless. */
  atmosphere: BodyAtmosphere | null;
  // ── Atmosphere convenience mirrors (kept for existing consumers) ────────
  /** `atmosphere !== null`. */
  hasAtmosphere: boolean | null;
  /** `atmosphere?.depth`. */
  maxAtmosphere: number | null;
  /** `atmosphere?.hasOxygen`. */
  hasOxygen: boolean | null;
}

function numOrNull(x: number | null | undefined): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function boolOrNull(x: boolean | null | undefined): boolean | null {
  return typeof x === "boolean" ? x : null;
}

function mapBody(
  entry: BodyEntry,
  byIndex: Map<number, BodyEntry>,
  ut: number | undefined,
): CelestialBody {
  const parentEntry =
    entry.parentIndex != null ? byIndex.get(entry.parentIndex) : undefined;
  const referenceBody = parentEntry?.name ?? null;
  const parentGravParameter = numOrNull(parentEntry?.gravParameter);

  const radius = numOrNull(entry.radius);
  const gravParameter = numOrNull(entry.gravParameter);

  const orbit = entry.orbit ?? null;
  const semiMajorAxis = orbit ? numOrNull(orbit.sma) : null;
  const eccentricity = orbit ? numOrNull(orbit.ecc) : null;
  const inclination = orbit ? numOrNull(orbit.inc) : null;
  const lan = orbit ? numOrNull(orbit.lan) : null;
  const argumentOfPeriapsis = orbit ? numOrNull(orbit.argPe) : null;
  const meanAnomalyAtEpoch = orbit ? numOrNull(orbit.meanAnomalyAtEpoch) : null;
  const epoch = orbit ? numOrNull(orbit.epoch) : null;

  const rawAtmosphere = entry.atmosphere ?? null;
  const atmosphere: BodyAtmosphere | null = rawAtmosphere
    ? {
        depth: numOrNull(rawAtmosphere.depth),
        hasOxygen: boolOrNull(rawAtmosphere.hasOxygen),
        seaLevelPressure: numOrNull(rawAtmosphere.seaLevelPressure),
      }
    : null;

  const mass = deriveMass(gravParameter);
  const parentMass = deriveMass(parentGravParameter);
  const rotationPeriod = numOrNull(entry.rotationPeriod);

  return {
    index: entry.index,
    name: entry.name ?? null,
    referenceBody,
    radius,
    soi: numOrNull(entry.sphereOfInfluence),
    gravParameter,
    semiMajorAxis,
    eccentricity,
    inclination,
    lan,
    argumentOfPeriapsis,
    meanAnomalyAtEpoch,
    epoch,
    period: derivePeriod(semiMajorAxis, parentGravParameter),
    trueAnomaly: deriveTrueAnomalyDeg({
      semiMajorAxis,
      eccentricity,
      meanAnomalyAtEpoch,
      epoch,
      parentGravParameter,
      ut,
    }),
    mass,
    geeASL: deriveSurfaceGravityG(gravParameter, radius),
    escapeVelocity: deriveEscapeVelocity(gravParameter, radius),
    hillSphere: deriveHillSphere(semiMajorAxis, eccentricity, mass, parentMass),
    rotationPeriod,
    tidallyLocked: boolOrNull(entry.tidallyLocked),
    rotates:
      rotationPeriod === null
        ? null
        : Number.isFinite(rotationPeriod) && rotationPeriod !== 0,
    hasOcean: boolOrNull(entry.hasOcean),
    description: entry.description ?? null,
    atmosphere,
    hasAtmosphere: atmosphere !== null,
    maxAtmosphere: atmosphere?.depth ?? null,
    hasOxygen: atmosphere?.hasOxygen ?? null,
  };
}

/**
 * Returns the list of celestial bodies from the `system.bodies` stream, each
 * enriched with derived almanac values. Empty until the first `system.bodies`
 * sample lands.
 */
export function useCelestialBodies(): CelestialBody[] {
  const systemBodies = useTelemetry("system.bodies");
  const ut = useViewUt();

  return useMemo(() => {
    const wire = systemBodies?.bodies;
    if (!wire || wire.length === 0) return [];
    const byIndex = new Map<number, BodyEntry>();
    for (const b of wire) byIndex.set(b.index, b);
    return wire.map((b) => mapBody(b, byIndex, ut));
  }, [systemBodies, ut]);
}
