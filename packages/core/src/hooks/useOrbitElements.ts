import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";

/**
 * Consolidated apo/peri/timeToAp/timeToPe orbital readings.
 *
 * Each field is `undefined` until the underlying data source emits a value
 * (or after a non-`connected` status transition clears it), mirroring
 * `useDataValue` semantics. On `VesselState` these fields are legitimately
 * `null` (not `undefined`) once ORBIT data has arrived but the specific
 * value is inapplicable, apoapsis on a hyperbolic trajectory (`ecc >= 1`
 * has no apoapsis), or the two time-to-apsis countdowns on the same
 * hyperbolic case. That `null` is deliberately passed through here rather
 * than folded into `undefined`: this hook's `!== undefined` contract with
 * callers (`CurrentOrbit`'s `hasOrbit` gate, in particular) treats "arrived,
 * value doesn't apply" as arrived, exactly the same as the legacy two-arg
 * `data`-source read this replaced, that shim's
 * generic `<number>` annotation never actually excluded `null` at runtime
 * either. The type below stays `number | undefined` for API compatibility;
 * see the inline casts.
 */
export interface OrbitElements {
  /** `o.ApR`: apoapsis radius from body centre, metres. */
  apoapsisRadius?: number;
  /** `o.PeR`: periapsis radius from body centre, metres. */
  periapsisRadius?: number;
  /** `o.ApA`: apoapsis altitude above body surface, metres. */
  apoapsisAltitude?: number;
  /** `o.PeA`: periapsis altitude above body surface, metres. */
  periapsisAltitude?: number;
  /** `o.timeToAp`: seconds until next apoapsis pass. */
  timeToApoapsis?: number;
  /** `o.timeToPe`: seconds until next periapsis pass. */
  timeToPeriapsis?: number;
}

/**
 * Read the standard apo/peri/timeToAp/timeToPe orbital elements in one call.
 *
 * Native read: the whole `vessel.state` derived channel (SDK-side
 * `deriveVesselState`), off the shim: the same channel `Targeting`/
 * `TargetPicker`/`ManeuverPlanner`/`CurrentOrbit` read for their own
 * `vessel.state.*` fields. See this file's class-level doc comment for why
 * a `null` value (arrived, inapplicable) is passed through as-is rather than
 * normalized to `undefined`.
 */
export function useOrbitElements(): OrbitElements {
  const vesselState = useStream<VesselState>("vessel.state");

  return {
    apoapsisRadius: vesselState?.apoapsisRadius as number | undefined,
    periapsisRadius: vesselState?.periapsisRadius as number | undefined,
    apoapsisAltitude: vesselState?.apoapsisAlt as number | undefined,
    periapsisAltitude: vesselState?.periapsisAlt as number | undefined,
    timeToApoapsis: vesselState?.timeToAp as number | undefined,
    timeToPeriapsis: vesselState?.timeToPe as number | undefined,
  };
}
