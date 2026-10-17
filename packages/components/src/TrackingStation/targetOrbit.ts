import {
  PropagationHorizonKindLike,
  solveOrbit,
} from "@ksp-gonogo/sitrep-client";
import {
  unlessLocked,
  type Value,
  type VesselOrbit,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import type { EncounterDirection } from "./encounter";
import { encounterDirectionOf } from "./encounter";

/** The elements the diagram draws a target's conic from; no true anomaly, since the conic is a path and the target is not plotted on it. */
export interface TargetConic {
  parentName: string;
  sma: number;
  ecc: number;
  lan: number;
  argPe: number;
  inclination: number;
  /** Radius of the sphere of influence of the body the conic is about, metres, which is as far as an open one is drawn. Null or absent where that body states none. */
  soi?: number | null;
}

/** The target's next sphere-of-influence transition, placed on its conic. */
export interface TargetEncounter {
  direction: EncounterDirection;
  /** The body transitioned into, or null when the transition leaves the current one or the body is unresolved. */
  bodyName: string | null;
  /** Where on the conic the boundary falls, degrees; null when the elements cannot say. */
  trueAnomaly: number | null;
}

/** The body a target's elements are about, when its conic can be drawn: finite, closed with a positive semi-major axis or open with any but zero, and about a body the catalogue names. A parabolic target has no conic to draw. */
export function targetParentOf(
  orbit: VesselOrbit | null | undefined,
  nameByIndex: ReadonlyMap<number, string>,
): string | null {
  if (orbit == null) return null;
  if (!orbit.sma.isFinite() || !orbit.ecc.isFinite()) return null;
  const open = orbit.ecc.greaterThan(1);
  if (!open && !orbit.ecc.lessThan(1)) return null;
  if (open ? orbit.sma.isZero() : !orbit.sma.isPositive()) return null;
  return nameByIndex.get(orbit.referenceBodyIndex) ?? null;
}

/** The target's encounter or escape, by its type; null for any other transition or none at all. */
export function targetEncounterOf(
  orbit: VesselOrbit | null | undefined,
  nameByIndex: ReadonlyMap<number, string>,
): TargetEncounter | null {
  const encounter = unlessLocked(orbit?.encounter ?? null);
  if (encounter == null) return null;
  const direction = encounterDirectionOf(encounter.transitionType);
  if (direction === null) return null;
  return {
    direction,
    bodyName:
      encounter.bodyIndex != null
        ? (nameByIndex.get(encounter.bodyIndex) ?? null)
        : null,
    trueAnomaly:
      orbit == null || !encounter.transitionUt.isFinite()
        ? null
        : solveOrbit(orbit, encounter.transitionUt, undefined).trueAnomaly,
  };
}

/**
 * Where the target was along its own orbit at the instant of the craft's report, in degrees, and whether that report is older than one orbit of the target.
 * Used beside a held route, to show where the plan was aimed against where the target was then.
 * The true anomaly is null where the elements cannot say, and an open orbit has no period, so it never outlasts one.
 */
export function targetAtReport(
  orbit: VesselOrbit | null | undefined,
  reportEpoch: Value<"ut"> | undefined,
  reportAge: Value<"s"> | undefined,
): { trueAnomaly: number | null; reportOutlastsOrbit: boolean } {
  if (orbit == null || reportEpoch === undefined) {
    return { trueAnomaly: null, reportOutlastsOrbit: false };
  }
  const { trueAnomaly, period } = solveOrbit(orbit, reportEpoch, undefined);
  return {
    trueAnomaly,
    reportOutlastsOrbit:
      period !== null &&
      reportAge !== undefined &&
      reportAge.greaterThan(value("s", period)),
  };
}

/** How far a target's published conic holds, as the provider stated it. */
export type TargetHorizon =
  | { kind: "unbounded" }
  | {
      kind: "until";
      untilUt: Value<"ut"> | null;
      /** The largest position drift over the whole window; null when the provider stated none. */
      drift: Value<"m"> | null;
    }
  | { kind: "unspecified" };

export function targetHorizonOf(
  orbit: VesselOrbit | null | undefined,
): TargetHorizon | null {
  const horizon = orbit?.horizon;
  if (horizon == null) return null;
  if (horizon.kind === PropagationHorizonKindLike.Unbounded)
    return { kind: "unbounded" };
  if (horizon.kind !== PropagationHorizonKindLike.Until)
    return { kind: "unspecified" };
  const knots = horizon.departure ?? null;
  const last = knots === null ? undefined : knots[knots.length - 1];
  return {
    kind: "until",
    untilUt: horizon.untilUt?.isFinite() ? horizon.untilUt : null,
    drift: last !== undefined && last.metres.isFinite() ? last.metres : null,
  };
}
