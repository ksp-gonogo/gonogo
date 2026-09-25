import { Quality } from "../__generated__/contract";
import {
  CONTROL_STATE_NAMES,
  type ControlStateName,
  collapseControlStateLevel,
  SAS_MODE_NAMES,
  type SasModeName,
  SITUATION_NAMES,
  type SituationName,
} from "../contract-enum-names";
import { magnitudeOr, type Quantityish } from "../magnitude";
import type { TimelinePoint } from "../timeline";
import {
  registerTopicUnits,
  type ShapesByField,
  type SitrepUnit,
  type UnitsByField,
} from "../units";
import type { ModelledField } from "./client-reading";
import { predictImpactPoint } from "./impact-point";
import type { OrbitElements } from "./kepler";
import {
  buildElements,
  keplerAdmissibility,
  magnitude,
  trySolve,
} from "./kepler-reckoning";
import { type LegacyOrbitPatch, mapOrbitPatch } from "./orbit-patches";
import { bodyRadiusOf, solveOrbit } from "./orbital-solve";
import { STANDARD_GRAVITY } from "./propagation";
import type { StreamStatusValue } from "./stream-status";
import { worstStatus } from "./stream-status";
import type { DerivedChannelDefinition, DerivedGet } from "./timeline-store";
import type {
  SystemBodiesPayload,
  VesselCommsPayload,
  VesselControlPayload,
  VesselFlightPayload,
  VesselIdentityPayload,
  VesselOrbitPayload,
  VesselPropulsionPayload,
} from "./wire-payloads";

/**
 * The quality-picked, widget-facing kinematic surface: picks a single
 * authoritative kinematics path per sample rather than leaving that choice
 * to each widget, avoiding the dual-altitude ambiguity that creates.
 *
 * The fields split two ways by basis. `horizontalSpeed` and the impact
 * prediction are surface-frame measurements straight off `vessel.flight`, so
 * they are live in the "measured" (Loaded) basis and `null` in the
 * "propagated" (OnRails) one rather than fabricating a body-less
 * approximation. The orbital-elements-derived fields
 * (`period`/`trueAnomaly`/`apoapsisAlt`/`periapsisAlt`/`timeToAp`/`timeToPe`
 * and the apsis radii) take the opposite split, because Loaded-basis orbital
 * elements are osculating garbage rather than a trajectory worth deriving a
 * period or an apsis from.
 */
export interface VesselState {
  /** Metres above sea level. `null` in the "propagated" basis (needs `system.bodies` radius; deferred); always sourced from `vessel.flight.altitudeAsl` in the "measured" basis. */
  altitudeAsl: number | null;
  /** m/s. Populated in BOTH bases: propagated from `|velocity|` when on-rails, taken straight from `vessel.flight.orbitalSpeed` when loaded. */
  orbitalSpeed: number | null;
  /**
   * Mission elapsed time, seconds: `viewUt - vessel.identity.launchUt`.
   * Populated in BOTH bases, because it reads no orbit. `null` before
   * launch (`launchUt` still `null` on `vessel.identity`), while
   * `vessel.identity` hasn't arrived yet (a secondary input, its absence
   * nulls this ONE field, not the whole record), or on a non-finite result.
   */
  met: number | null;
  /**
   * Orbital period, seconds: `2π·sqrt(sma³/mu)`. OnRails basis only; `null`
   * in the "measured" basis or on a non-finite result (e.g. a degenerate
   * `mu`).
   */
  period: number | null;
  /**
   * True anomaly at `viewUt`, DEGREES wrapped to [0, 360), the KSP
   * widget-facing convention (`vessel.orbit.inc`/`argPe`'s own
   * precedent; `kepler.ts`'s internal radians are converted at this
   * boundary, never leaked past it). OnRails basis only; `null` in the
   * "measured" basis. Reuses `kepler.solveAnomalies`: never a second Kepler
   * solve.
   */
  trueAnomaly: number | null;
  /**
   * Apoapsis altitude above the reference body's mean radius, metres:
   * `sma·(1+ecc) - bodyRadius`. OnRails basis only. `undefined` while
   * `system.bodies` isn't whole yet, or is whole but doesn't (yet) carry the
   * referenced body's radius: both "still resyncing", never conflated with
   * `null` (see the class-level `undefined` vs `null` discipline, applied
   * here at the FIELD level: `system.bodies` tombstoned is a confirmed
   * absence and DOES map to `null`). `null` in the "measured" basis or on a
   * non-finite result.
   */
  apoapsisAlt: number | null | undefined;
  /** Periapsis altitude above the reference body's mean radius, metres: `sma·(1-ecc) - bodyRadius`. Same basis/`undefined`-vs-`null` rules as `apoapsisAlt`. */
  periapsisAlt: number | null | undefined;
  /**
   * Seconds from `viewUt` until the mean anomaly next reaches apoapsis (π),
   * wrapped forward: 0 if already there. OnRails basis only; `null` in the
   * "measured" basis or on a non-finite/non-positive mean motion.
   */
  timeToAp: number | null;
  /** Seconds from `viewUt` until the mean anomaly next reaches periapsis (0), wrapped forward. Same basis/finite-guard rules as `timeToAp`. */
  timeToPe: number | null;
  /**
   * Name of the body the vessel currently belongs to, the display-map
   * resolution of `vessel.identity.parentBodyIndex` against `system.bodies`
   * as a display string. Populated in BOTH bases (needs only
   * the index + the body table, no orbital propagation). `undefined` while
   * `vessel.identity` hasn't arrived, the index isn't resolvable yet (body or
   * its name not in `system.bodies` yet, or `system.bodies` itself not whole),
   * or there is no parent index at all; `null` when `system.bodies` is a
   * confirmed tombstone: same `undefined`-vs-`null` "still resyncing vs.
   * confirmed absent" discipline as `apoapsisAlt`/`periapsisAlt`.
   */
  parentBodyName: string | null | undefined;
  /**
   * Name of the vessel's orbit reference body, the display-map resolution of
   * `vessel.orbit.referenceBodyIndex` against `system.bodies`, as a display
   * string. Populated in BOTH bases; same
   * `undefined`-vs-`null` rules as `parentBodyName`.
   */
  referenceBodyName: string | null | undefined;
  /**
   * Mean radius of the body the vessel belongs to, metres, resolved against
   * `system.bodies` by the same index as `parentBodyName`. Same
   * `undefined`-vs-`null` rules.
   *
   * <p>Exposed because the alternative callers reach for is a name lookup in a
   * client-side table of STOCK bodies, which under a planet pack describes a
   * solar system nobody is flying in: the name misses, the radius comes back
   * undefined, and whatever needed it quietly stops working. The radius was
   * already resolved here off the wire for the apsides, so a caller that wants
   * it should be able to read it rather than reconstruct it.</p>
   */
  parentBodyRadius: number | null | undefined;
  /**
   * Mean radius of the orbit's reference body, metres, resolved by the same
   * index as `referenceBodyName`. The one orbital mechanics wants: an altitude
   * a transfer targets is measured from the body being orbited.
   */
  referenceBodyRadius: number | null | undefined;
  /**
   * Next-SOI-transition SIGN: the display-map resolution of
   * `vessel.orbit.encounter` to the -1/0/1 scalar OrbitalEventChips reads as
   * `o.encounterExists`: `1` = ENCOUNTER (entering another body's SOI,
   * `TransitionType.Encounter`), `-1` = ESCAPE (leaving the current SOI,
   * `TransitionType.Escape`), `0` = none (no encounter record, or a
   * transition type the chip doesn't surface: Initial/Final/Maneuver/
   * Collision/Unknown). `transitionType` DOES matter here, the widget keys
   * its encounter-vs-escape variant off the sign, so a plain boolean would
   * lose that distinction. `0` (a DEFINED "no encounter") whenever
   * `vessel.orbit` is present but carries no encounter; never `undefined`,
   * since `vessel.orbit`'s own presence already gates the whole record.
   * Populated in BOTH bases (KSP predicts patched-conic transitions
   * regardless of on-rails/loaded).
   */
  encounterExists: number | null | undefined;
  /**
   * Encounter body NAME: `vessel.orbit.encounter.bodyIndex` resolved against
   * `system.bodies`. `undefined` when there
   * is no encounter, the index isn't resolvable yet, or `system.bodies` hasn't
   * arrived; `null` when `system.bodies` is a confirmed tombstone. Same
   * `resolveBodyName` discipline as `parentBodyName`.
   */
  encounterBody: string | null | undefined;
  /**
   * The ABSOLUTE UT of the SOI transition: `vessel.orbit.encounter.transitionUt`
   * carried through unchanged. `undefined` when there is no encounter or the
   * value is non-finite.
   *
   * Named `encounterUt` and NOT `encounterTime`, because a name that does not
   * say which of the two it is gets read as the other one. The same event has a
   * DURATION ("seconds until the SOI transition") and an ABSOLUTE INSTANT, and
   * a consumer reading this instant as a duration renders a Mun encounter
   * twenty minutes away as "46d 2h", then holds the chip up forever on a
   * `> 0` guard that every UT passes. Both of those shipped, in two widgets.
   *
   * So: this is an instant, a consumer wants `encounterUt - viewUt`, and the
   * two must never be collapsed back into one field. `Units.UniversalTime`
   * exists as a separate token from `Units.Seconds` for exactly this reason:
   * "s" reads the same on a duration and on a point in time.
   */
  encounterUt: number | null | undefined;
  /**
   * Apoapsis RADIUS (distance from the reference body's CENTER, metres),
   * `sma·(1+ecc)`, read as a plain number by everything that draws an orbit.
   * Derived straight from the orbit elements, so: unlike `apoapsisAlt`, which
   * subtracts the body radius and is therefore `undefined` until
   * `system.bodies` carries it: this needs NO body table and is always a
   * finite number OnRails (`apoapsisAlt = apoapsisRadius - bodyRadius`
   * whenever the radius is known). OnRails basis only; `null` in the
   * "measured" basis or on a non-finite result.
   */
  apoapsisRadius: number | null;
  /** Periapsis RADIUS from the body center, metres: `sma·(1-ecc)` (old `o.PeR`). Same basis/finite-guard rules as `apoapsisRadius`. */
  periapsisRadius: number | null;
  /**
   * Current orbital RADIUS: distance from the reference body's center,
   * metres: `|position|`, the propagated parent-body-relative position vector,
   * which a vis-viva solve takes as its radius term. OnRails basis only (needs
   * the propagated position); `null` in the "measured" basis (no position
   * vector there) or on a non-finite result.
   */
  orbitalRadius: number | null;
  /**
   * Which apsis comes NEXT: `1` = apoapsis, `-1` = periapsis (the convention
   * OrbitalEventChips/SystemView read; `0`/N-A never emitted, and `null` when
   * neither apsis is reachable). Derived
   * by picking whichever of `timeToAp`/`timeToPe` is the smaller non-null
   * countdown. OnRails basis only (both countdowns are `null` in the
   * "measured" basis); `null` when neither countdown is available.
   */
  nextApsisType: number | null;
  /**
   * Seconds until the next apsis: the `timeToAp`/`timeToPe` matching
   * `nextApsisType`. OnRails basis only;
   * `null` when neither countdown is available.
   */
  timeToNextApsis: number | null;
  /**
   * Horizontal (surface-tangent) speed, m/s: `sqrt(surfaceSpeed² -
   * verticalSpeed²)` over `vessel.flight`'s two surface-frame rates, the
   * Pythagorean split of the measured surface velocity (OrbitalAscent's
   * ascent read). MEASURED basis only. Clamped at 0 before the sqrt so
   * floating-point `surfaceSpeed < verticalSpeed` noise never yields NaN.
   * `null` in the "propagated" basis or on a non-finite result.
   */
  horizontalSpeed: number | null;
  /**
   * Situation NAME: the display-map resolution of `vessel.identity.situation`
   * (a numeric `Sitrep.Contract.Situation` enum ordinal on the wire) to its
   * enum name string ("Landed", "Orbiting", ...). This is the situation string
   * ScienceBench renders. Populated in
   * BOTH bases (needs only `vessel.identity`, no propagation). `undefined`
   * while `vessel.identity` hasn't arrived or the ordinal is out of the enum's
   * range (unrecognized: "still resyncing"); `null` when `vessel.identity` is
   * a confirmed tombstone. `Situation.Unknown` (ordinal 8) is a DEFINED value
   * and resolves to the literal name "Unknown", not `undefined`.
   */
  situationName: SituationName | null | undefined;
  /**
   * SAS-mode NAME: the display-map resolution of `vessel.control.sasMode` (a
   * numeric `Sitrep.Contract.SasMode` enum ordinal) to its enum name string,
   * the SAS-mode string. The names match
   * Navball's `SAS_MODES` union EXACTLY (both mirror KSP's
   * `VesselAutopilot.AutopilotMode` order), so the widget's `sasMode === mode`
   * active-button compare works unchanged. Populated in BOTH bases.
   * `undefined` while `vessel.control` hasn't arrived, when `sasMode` is `null`
   * (not available this tick), or when the ordinal is out of range; `null`
   * when `vessel.control` is a confirmed tombstone. `SasMode.Unknown` (ordinal
   * 10) resolves to "Unknown" (not in `SAS_MODES`, so no button highlights,
   * the same benign outcome as the legacy path).
   */
  sasModeName: SasModeName | null | undefined;
  /**
   * Comms control-state NAME: the display-map resolution of
   * `vessel.comms.controlState` (a numeric `Sitrep.Contract.ControlState` enum
   * ordinal) to its enum name string ("None", "Partial", "Full", "ProbeFull",
   * ...), the string CommSignal prefers for its label + tone. `undefined`
   * while `vessel.comms`
   * hasn't arrived or the ordinal is out of range; `null` on a confirmed
   * tombstone. `ControlState.Unknown` (ordinal 11) resolves to "Unknown".
   */
  commsControlStateName: ControlStateName | null | undefined;
  /**
   * Comms control-state ORDINAL in CommSignal's 0/1/2 LEVEL scheme
   * (0=none, 1=partial, 2=full), DERIVED from `vessel.comms.controlState`'s
   * `Sitrep.Contract.ControlState` enum by collapsing its 11 richer values
   * onto the three control LEVELS CommSignal branches on (bars fallback +
   * hasData): any `*Full`/bare `Probe`/`Kerbal` → 2, any `*Partial` → 1, any
   * `*None`/bare `None` → 0. `undefined` while `vessel.comms` hasn't arrived,
   * for `ControlState.Unknown`, or an out-of-range ordinal; `null` on a
   * confirmed tombstone.
   */
  commsControlStateOrdinal: number | null | undefined;
  /**
   * Thrust-to-weight ratio (dimensionless): `currentThrust / (totalMass·g)`
   * off `vessel.propulsion` (the Twr widget),
   * with `g` = standard gravity (9.80665 m/s²), the same constant KSP's own
   * TWR readout uses. Populated in BOTH bases (self-relative, no orbital
   * propagation). `undefined` while `vessel.propulsion` hasn't arrived or
   * `totalMass` is ≤ 0 (no meaningful weight to divide by); `null` on a
   * confirmed `vessel.propulsion` tombstone or a non-finite result.
   */
  twr: number | null | undefined;
  /**
   * Whether the vessel currently has command control, derived from
   * `vessel.comms.controlState` (Navball):
   * `true` when the control state maps to a non-zero control LEVEL (any
   * Partial/Full/Probe/Kerbal control), `false` for the *None family
   * (`None`/`ProbeNone`/`KerbalNone`). Populated in BOTH bases. `undefined`
   * while `vessel.comms` hasn't arrived or the state is `Unknown` (no level);
   * `null` on a confirmed tombstone.
   */
  isControllable: boolean | null | undefined;
  /**
   * Whether the active vessel is a kerbal on EVA, `vessel.identity.vesselType
   * === EVA` (CrewStatus). Populated in BOTH
   * bases. `undefined` while `vessel.identity` hasn't arrived; `null` on a
   * confirmed tombstone.
   */
  isEVA: boolean | null | undefined;
  /**
   * Whether the vessel is splashed down, `vessel.identity.situation ===
   * Splashed`. Populated in BOTH
   * bases. `undefined` while `vessel.identity` hasn't arrived; `null` on a
   * confirmed tombstone.
   */
  isSplashed: boolean | null | undefined;
  /**
   * Predicted surface-impact latitude, degrees: `predictImpactPoint`
   * (`impact-point.ts`) over this frame's `vessel.orbit`, `vessel.flight` and
   * `system.bodies`, so `null` wherever that answers none. MEASURED basis
   * only; `null` in the propagated basis.
   */
  landingPredictedLat: number | null;
  /** Predicted surface-impact longitude, degrees. Same discipline as `landingPredictedLat`; always defined together. */
  landingPredictedLon: number | null;
  /**
   * The vessel's future-orbit patch chain, legacy-shaped (behind
   * `o.orbitPatches`, MapView's trajectory-overlay/maneuver-preview reads),
   * a reshape of `vessel.orbit.patches` via `mapOrbitPatch`, populated in
   * BOTH bases (pure reshape, no propagation needed, the mod already
   * walked the chain). `undefined` before `vessel.orbit` arrives (mirrors
   * the whole record); an empty array is the common case (no upcoming SOI
   * transition on the current trajectory).
   */
  orbitPatches: LegacyOrbitPatch[];
  /** `vessel:<guid>`: subject provenance, from the orbit PAYLOAD's own `meta.source`; empty when the sample carries none. */
  subjectId: string;
}

/** `x` if finite, else `null`: the discipline every new derived scalar field in this file follows (never a NaN/Infinity escapes onto `VesselState`). */
/**
 * A wire quantity's magnitude, or `NaN` when the field is absent.
 *
 * `magnitudeOr(v, NaN)` rather than a local unwrap: the canonical pair lives in
 * this package now (`../magnitude`), so there is one implementation and one
 * place that decides what a missing `.magnitude` means.
 *
 * NaN is the right FALLBACK here specifically, and the arithmetic below is why.
 * A Topic sends a subset of its fields routinely and the wrap deliberately
 * leaves an absent field absent, so the arithmetic below sees `undefined` and
 * produces NaN, which every guard here already accounts for (`finiteOrNull`,
 * `!(h > 0)`, `Number.isFinite`). A NaN fallback keeps exactly that. The
 * alternative, threading `null` through a dozen expressions, buys nothing the
 * guards do not already do.
 *
 * What it does NOT license is handing NaN onward. Every field this feeds goes
 * through `finiteOrNull` before it reaches `VesselState`, because those fields
 * declare `number | null` and a consumer's `??` does not catch NaN. Four of
 * them skipped that and the readings they fed stopped tripping their
 * thresholds; see `vessel-state-partial-flight.test.ts`.
 */
function mag(v: Quantityish): number {
  return magnitudeOr(v, Number.NaN);
}

function finiteOrNull(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

/**
 * Resolve a body INDEX (the stable `SystemBodyPayload.index`, never array
 * position) to its NAME string via `system.bodies`, the client-side
 * display-map behind `vessel.state.parentBodyName`/`referenceBodyName`, the
 * the body-NAME display strings
 * (`map-topic.ts`). Mirrors `deriveApsides`'s `undefined`-vs-`null`
 * discipline:
 * - `undefined` ("still resyncing / not resolvable yet") when there's no
 *   index to resolve (`null`/`undefined`: e.g. `vessel.identity` absent, or
 *   a body with no parent), when `system.bodies` hasn't arrived, or when it
 *   HAS arrived but the referenced body (or its name specifically) isn't in
 *   it yet.
 * - `null` only when `system.bodies` is an outright tombstone, a confirmed
 *   absence.
 * Never throws on a missing index / missing table, that's a deliberate
 * "not-yet-loaded" case, not an error.
 */
function resolveBodyName(
  get: DerivedGet,
  index: number | null | undefined,
): string | null | undefined {
  if (index == null) return undefined;
  const bodiesPoint = get<SystemBodiesPayload>("system.bodies");
  if (!bodiesPoint) return undefined;
  if (bodiesPoint.payload === null) return null;
  const body = bodiesPoint.payload.bodies.find((b) => b.index === index);
  return body?.name ?? undefined;
}

/** `Sitrep.Contract.TransitionType` ordinals the encounter chip surfaces (VesselEnums.cs). */
const TRANSITION_TYPE_ENCOUNTER = 2;
const TRANSITION_TYPE_ESCAPE = 3;

/**
 * Resolve `vessel.orbit.encounter` to OrbitalEventChips' three legacy scalars
 * (`o.encounterExists`/`o.encounterBody`/`o.UTsoi`). `orbit` is always
 * present here (its channel gates the whole `vessel.state` record), so a
 * missing/`null` encounter is a DEFINED "no encounter", `encounterExists` 0,
 * body/time `undefined`: never the whole-record `undefined`/`null`. The body
 * NAME follows `resolveBodyName`'s `undefined`-vs-`null` discipline against
 * `system.bodies`. Never throws on a missing encounter / missing body table.
 */
function deriveEncounter(
  get: DerivedGet,
  orbit: VesselOrbitPayload,
): {
  encounterExists: number | null | undefined;
  encounterBody: string | null | undefined;
  encounterUt: number | null | undefined;
} {
  const encounter = orbit.encounter;
  if (encounter == null) {
    return {
      encounterExists: 0,
      encounterBody: undefined,
      encounterUt: undefined,
    };
  }
  const encounterExists =
    encounter.transitionType === TRANSITION_TYPE_ENCOUNTER
      ? 1
      : encounter.transitionType === TRANSITION_TYPE_ESCAPE
        ? -1
        : 0;
  return {
    encounterExists,
    encounterBody: resolveBodyName(get, encounter.bodyIndex),
    encounterUt: Number.isFinite(mag(encounter.transitionUt))
      ? mag(encounter.transitionUt)
      : undefined,
  };
}

/**
 * Resolve a body INDEX to its mean radius (metres) via `system.bodies`, the
 * radius half of `deriveApsides`'s lookup. Same
 * `undefined`-vs-`null` discipline as `resolveBodyName`: `undefined` when
 * there's no index, `system.bodies` hasn't arrived, or the body / its radius
 * isn't in it yet; `null` only on a `system.bodies` tombstone.
 */
function resolveBodyRadius(
  get: DerivedGet,
  index: number | null | undefined,
): number | null | undefined {
  if (index == null) return undefined;
  const bodiesPoint = get<SystemBodiesPayload>("system.bodies");
  if (!bodiesPoint) return undefined;
  // The lookup and its three-way discipline live beside `solveOrbit`, which is
  // the other thing that needs a body radius. This is the part that reads the
  // topic, which is the only part that belongs to this channel.
  return bodyRadiusOf(bodiesPoint.payload, index);
}

/**
}

/**
 * Generic enum-ordinal → NAME display-map resolver reading a single source
 * channel, mirroring `resolveBodyName`'s `undefined`-vs-`null` discipline:
 * `undefined` when the channel hasn't arrived (no point) or the ordinal is out
 * of the `names` table's range ("still resyncing / unrecognized"); `null` on a
 * confirmed tombstone. `ordinalOf` pulls the raw ordinal off the payload,
 * returning `null`/`undefined` for a field-level "not available this tick"
 * (mapped to `undefined`, never `null`, since it isn't a whole-channel
 * absence). Never throws on a missing channel / missing field.
 */
function resolveEnumName<T, N extends string>(
  get: DerivedGet,
  topic: string,
  ordinalOf: (payload: T) => number | null | undefined,
  names: readonly string[],
): N | null | undefined {
  const point = get<T>(topic);
  if (!point) return undefined;
  if (point.payload === null) return null;
  const ordinal = ordinalOf(point.payload);
  if (ordinal == null) return undefined;
  return (names[ordinal] as N | undefined) ?? undefined;
}

/**
 * `vessel.comms.controlState`'s `ControlState` ordinal collapsed to CommSignal's
 * 0/1/2 control-level scheme (`vessel.state.commsControlStateOrdinal`).
 * Same channel-presence discipline as `resolveEnumName`: `undefined` when
 * `vessel.comms` hasn't arrived or the ordinal is out of range / maps to no
 * level (`Unknown`); `null` on a confirmed tombstone.
 */
function resolveCommsControlStateOrdinal(
  get: DerivedGet,
): number | null | undefined {
  const point = get<VesselCommsPayload>("vessel.comms");
  if (!point) return undefined;
  if (point.payload === null) return null;
  return collapseControlStateLevel(point.payload.controlState);
}

/**
 * All four enum-ordinal display maps carried on `vessel.state`,
 * `v.situationString`/`f.sasMode`/`comm.controlStateName` + numeric
 * `comm.controlState`. Bundled so both quality branches of
 * `deriveVesselState` populate them identically: each needs only its source
 * channel (`vessel.identity`/`vessel.control`/`vessel.comms`), no orbital
 * propagation, so they're live in the Loaded (measured) basis too, same as the
 * body-name display maps.
 */
function deriveEnumDisplayMaps(get: DerivedGet): {
  situationName: SituationName | null | undefined;
  sasModeName: SasModeName | null | undefined;
  commsControlStateName: ControlStateName | null | undefined;
  commsControlStateOrdinal: number | null | undefined;
} {
  return {
    situationName: resolveEnumName<VesselIdentityPayload, SituationName>(
      get,
      "vessel.identity",
      (p) => p.situation,
      SITUATION_NAMES,
    ),
    sasModeName: resolveEnumName<VesselControlPayload, SasModeName>(
      get,
      "vessel.control",
      (p) => p.sasMode,
      SAS_MODE_NAMES,
    ),
    commsControlStateName: resolveEnumName<
      VesselCommsPayload,
      ControlStateName
    >(get, "vessel.comms", (p) => p.controlState, CONTROL_STATE_NAMES),
    commsControlStateOrdinal: resolveCommsControlStateOrdinal(get),
  };
}

/** `Sitrep.Contract.VesselType.EVA` ordinal (VesselEnums.cs declaration order). */
const VESSEL_TYPE_EVA = 7;
/** `Sitrep.Contract.Situation.Splashed` ordinal (VesselEnums.cs declaration order). */
const SITUATION_SPLASHED = 1;

/**
 * Thrust-to-weight ratio off `vessel.propulsion` (`vessel.state.twr`, old
 * `dv.currentTWR`): `currentThrust / (totalMass · g)`, with `g` the same
 * standard gravity KSP's own TWR readout uses. `undefined` when
 * `vessel.propulsion` hasn't arrived or `totalMass` is ≤ 0 (no weight to
 * divide by); `null` on a confirmed tombstone or a non-finite result. Same
 * channel-presence discipline as `resolveEnumName`.
 */
function deriveTwr(get: DerivedGet): number | null | undefined {
  const point = get<VesselPropulsionPayload>("vessel.propulsion");
  if (!point) return undefined;
  if (point.payload === null) return null;
  const { currentThrust, totalMass } = point.payload;
  if (!(totalMass > 0)) return undefined;
  const twr = currentThrust / (totalMass * STANDARD_GRAVITY);
  return Number.isFinite(twr) ? twr : null;
}

/**
 * Whether the vessel has command control (`vessel.state.isControllable`, old
 * `v.isControllable`): derived from `vessel.comms.controlState` via the same
 * `CONTROL_STATE_LEVEL` collapse `commsControlStateOrdinal` uses: a non-zero
 * control level (any Partial/Full/Probe/Kerbal control) is controllable; the
 * *None family collapses to level 0 → not controllable. `undefined` when
 * `vessel.comms` hasn't arrived or the state is `Unknown` (no level); `null`
 * on a confirmed tombstone. Fixes the naive "ControlState != None" reading,
 * which would wrongly call a `ProbeNone`/`KerbalNone` vessel controllable.
 */
function deriveIsControllable(get: DerivedGet): boolean | null | undefined {
  const point = get<VesselCommsPayload>("vessel.comms");
  if (!point) return undefined;
  if (point.payload === null) return null;
  const level = collapseControlStateLevel(point.payload.controlState);
  return level === undefined ? undefined : level > 0;
}

/**
 * The two `vessel.identity`-derived boolean flags (`vessel.state.isEVA`/
 * `isSplashed`, old `v.isEVA`/`v.splashed`): EVA from the `vesselType`
 * ordinal, splashed from the `situation` ordinal. Bundled so both quality
 * branches populate them identically off the one channel. `undefined` (both)
 * while `vessel.identity` hasn't arrived; `null` (both) on a confirmed
 * tombstone.
 */
function deriveIdentityFlags(get: DerivedGet): {
  isEVA: boolean | null | undefined;
  isSplashed: boolean | null | undefined;
} {
  const point = get<VesselIdentityPayload>("vessel.identity");
  if (!point) return { isEVA: undefined, isSplashed: undefined };
  if (point.payload === null) return { isEVA: null, isSplashed: null };
  return {
    isEVA: point.payload.vesselType === VESSEL_TYPE_EVA,
    isSplashed: point.payload.situation === SITUATION_SPLASHED,
  };
}

/**
 * The `vessel.state` derivation. Reads `vessel.orbit`
 * + `vessel.flight` at the SAME frozen `viewUt` (the `get` closure enforces
 * this structurally: see `TimelineStore`) and quality-picks per
 * `Meta.Quality`, keyed off the ORBIT sample's quality specifically ("the
 * picker input is the quality on the orbit sample at viewUt", so a
 * historical scrub through a regime change replays the switch
 * faithfully from archived quality stamps, not a live global flag):
 *
 * - **OnRails** (coasting): `vessel.orbit` is the CAUSE. Convert the wire's
 *   degrees→radians ONCE here (`meanAnomalyAtEpoch` is already radians, the
 *   documented KSP unit-convention quirk), substitute 0 for a `null`
 *   `lan`/`argPe` (the physically-degenerate near-equatorial/near-circular
 *   case: substituting 0 doesn't change the resulting state vector, it just
 *   picks an arbitrary node/apsis reference on a circle where none is
 *   physically distinguished), then `kepler.solve(elements, viewUt)` for
 *   position/velocity, plus `kepler.solveAnomalies(elements, viewUt)` for
 *   `period`/`trueAnomaly`/`timeToAp`/`timeToPe` (derivable straight from
 *   the same elements, no extra input). `met` additionally reads
 *   `vessel.identity.launchUt`; `apoapsisAlt`/`periapsisAlt` additionally
 *   read `system.bodies` for the reference body's radius (`deriveApsides`).
 *   Both are now declared in `vesselStateChannel.inputs` (see that const's
 *   own doc comment for why growing that array is a real, deliberate,
 *   repo-wide change and not a free extra input to add lightly).
 * - **Loaded** (powered/atmospheric): elements are osculating garbage for
 *   surface quantities, so altitude/vertical/surface speed come off
 *   `vessel.flight` at `viewUt` via `getInterpolated`: a straight-line lerp
 *   between the two buffered `vessel.flight` samples straddling `viewUt`
 *   (`ClientTimeline.straddle` is the seam).
 *   Falls back to hold-last itself when there's nothing to straddle (e.g.
 *   only one `vessel.flight` sample so far).
 *
 * **`undefined` vs `null`, never conflated**: no `vessel.orbit` point
 * at-or-before `viewUt` yet means the input isn't whole yet (cold start, or
 * resynchronizing after an epoch reset until the first post-reset keyframe
 * lands): there is no quality signal to pick with, but nothing has
 * confirmed the vessel is gone either, so the whole record is `undefined`
 * ("resynchronizing"). A *tombstoned* `vessel.orbit` point (a real point
 * whose `payload` is `null`) means the vessel itself is confirmed absent, so
 * the record is `null`. Loaded quality with no `vessel.flight` point yet is
 * `undefined` for the same not-whole-yet reason; a tombstoned
 * `vessel.flight` is `null`. Never a fabricated zero-valued record either
 * way.
 */
/** The `null`-when-not-derivable impact coordinates `deriveLanding` produces. */
interface LandingDerivations {
  landingPredictedLat: number | null;
  landingPredictedLon: number | null;
}

/** Both coordinates `null`: the propagated basis and the not-derivable measured case. */
const LANDING_NONE: LandingDerivations = {
  landingPredictedLat: null,
  landingPredictedLon: null,
};

/**
 * The impact point for the measured basis: `predictImpactPoint` over this
 * frame's samples, which is where the whole solve and its propagation seam
 * live.
 *
 * ## It predicts a future EVENT, and that is not what a reckoner does
 *
 * A reckoner carries a topic's OWN value forward past the last observation of
 * it, and every field it moves is that field at the view time. This pair is a
 * different claim: a quantity ABOUT an event that has not happened, computed
 * from measurements at the view time, and stale in exactly the way its inputs
 * are. Reckoning it would mean claiming the descent continued the way the
 * arithmetic says, and a descent is the one regime where that is least
 * defensible: the whole reason `atmospheric-reckoning.ts` exists is that a
 * craft in air is not following anything a closed form here describes.
 *
 * The two never overlap, and the code says so rather than the comment:
 * `keplerAdmissibility` withdraws for a craft under physics, which is every
 * frame this produces a number on, so `deriveVesselStateReckoning` returns
 * `undefined` on precisely those frames. The pair is also absent from
 * `KEPLER_MODELLED_FIELDS` because it does not exist on that branch at all
 * (`LANDING_NONE` there). Both facts are pinned in
 * `vessel-state-prediction-paths.test.ts`.
 */
function deriveLanding(
  get: DerivedGet,
  orbit: VesselOrbitPayload,
  flight: VesselFlightPayload,
  viewUt: number,
): LandingDerivations {
  const bodies = get<SystemBodiesPayload>("system.bodies")?.payload;
  const impact = predictImpactPoint({ orbit, flight, bodies, viewUt });
  if (!impact) return LANDING_NONE;
  return {
    landingPredictedLat: impact.lat,
    landingPredictedLon: impact.lon,
  };
}

/**
 * `viewUt - launchUt`, or `null` while the identity names no launch clock. The
 * same in both bases: a craft under physics has the same mission clock as one on
 * rails, and a launch is exactly when a craft is under physics.
 */
function missionElapsed(
  identityPoint: TimelinePoint<VesselIdentityPayload> | undefined,
  viewUt: number,
): number | null {
  const launchUt =
    identityPoint && identityPoint.payload !== null
      ? identityPoint.payload.launchUt
      : null;
  return launchUt == null ? null : finiteOrNull(viewUt - launchUt);
}

export function deriveVesselState(
  get: DerivedGet,
  viewUt: number,
  // Defaults to `get`, so a caller that omits it samples hold-last throughout,
  // which is what every call site written before interpolation existed expects.
  getInterpolated: DerivedGet = get,
): VesselState | null | undefined {
  const orbitPoint = get<VesselOrbitPayload>("vessel.orbit");
  if (!orbitPoint) return undefined; // not whole yet, no point at all
  if (orbitPoint.payload === null) return null; // tombstone, vessel confirmed absent

  const quality = orbitPoint.meta.quality;
  /*
   * The PAYLOAD's provenance, never the envelope's. The envelope `meta.source`
   * is the Courier node, which `NodeForTopic` resolves to the literal "system"
   * for every non-fleet topic, so reading it named every craft in the game
   * "system" and no `commandCentre.roster` id could ever equal it. That made
   * `PilotVantage` unsatisfiable and left the mod's own zero-delay row for a
   * pilot's craft unreachable. The fabricated fixtures could not catch it: they
   * stamped `"vessel:<guid>"` onto the envelope, which the wire never does.
   */
  const subjectId = orbitPoint.payload.meta?.source ?? "";
  const orbit = orbitPoint.payload;
  // Pure reshape of already-solved patches (mod-side, no propagation), so it is
  // safe to compute once ahead of the quality branch and reuse in both.
  // Element 0 is the current orbit; see `orbit-patches.ts`.
  const orbitPatchesLegacy = (orbit.patches ?? []).map(mapOrbitPatch);

  if (quality === Quality.OnRails) {
    const elements: OrbitElements = buildElements(orbit);
    // A hyperbolic orbit (ecc >= 1, real on a fast escape/flyby while
    // time-warping) can't go through kepler's elliptical-only solver, so
    // `trySolve` degrades to null instead of throwing and the velocity below
    // degrades with it. The orbital scalars take the same degradation inside
    // `solveOrbit`, which is where that reasoning now lives in full.
    const velocity = trySolve(elements, viewUt)?.velocity ?? null;

    /*
     * The body radius is resolved here rather than inside the solve because
     * the three-way discipline over `system.bodies` belongs to this channel;
     * the mathematics does not need to know about it.
     */
    const orbitals = solveOrbit(
      orbit,
      viewUt,
      resolveBodyRadius(get, orbit.referenceBodyIndex),
    );
    const { period, trueAnomaly, timeToAp, timeToPe } = orbitals;

    // A secondary input: its own absence nulls ONLY `met`, not the whole
    // record. Contrast `vessel.orbit` and `vessel.flight` above, whose absence
    // is a whole-record `undefined` or `null`; see `VesselState.met`'s doc.
    const identityPoint = get<VesselIdentityPayload>("vessel.identity");
    const met = missionElapsed(identityPoint, viewUt);

    const { apoapsisAlt, periapsisAlt } = orbitals;

    const parentBodyIndex =
      identityPoint && identityPoint.payload !== null
        ? identityPoint.payload.parentBodyIndex
        : null;
    const parentBodyName = resolveBodyName(get, parentBodyIndex);
    const referenceBodyName = resolveBodyName(get, orbit.referenceBodyIndex);
    const parentBodyRadius = resolveBodyRadius(get, parentBodyIndex);
    const referenceBodyRadius = resolveBodyRadius(
      get,
      orbit.referenceBodyIndex,
    );

    const orbitalRadius = orbitals.orbitalRadius;

    return {
      /*
       * The solved radius less the reference body's, which is what an altitude
       * ASL is. `horizontalSpeed` below stays null on this basis and is a
       * different case: it is a surface-frame rate that needs the body's
       * rotation, not a subtraction.
       */
      altitudeAsl:
        orbitalRadius == null
          ? null
          : (() => {
              const radius = resolveBodyRadius(get, orbit.referenceBodyIndex);
              return radius == null
                ? null
                : finiteOrNull(orbitalRadius - magnitudeOr(radius, Number.NaN));
            })(),
      orbitalSpeed: velocity == null ? null : magnitude(velocity),
      met,
      period,
      trueAnomaly,
      apoapsisAlt,
      periapsisAlt,
      timeToAp,
      timeToPe,
      parentBodyName,
      referenceBodyName,
      parentBodyRadius,
      referenceBodyRadius,
      ...deriveEncounter(get, orbit),
      apoapsisRadius: orbitals.apoapsisRadius,
      periapsisRadius: orbitals.periapsisRadius,
      orbitalRadius,
      nextApsisType: orbitals.nextApsisType,
      timeToNextApsis: orbitals.timeToNextApsis,
      // Surface-frame horizontal speed is a MEASURED quantity, null in the
      // propagated basis.
      horizontalSpeed: null,
      ...deriveEnumDisplayMaps(get),
      twr: deriveTwr(get),
      isControllable: deriveIsControllable(get),
      ...deriveIdentityFlags(get),
      // The impact prediction is a surface-frame MEASURED quantity off vessel.flight, so it is null in the propagated basis, like altitudeAsl/horizontalSpeed above.
      ...LANDING_NONE,
      orbitPatches: orbitPatchesLegacy,
      subjectId,
    };
  }

  // Loaded: orbital elements are osculating garbage here, so every
  // orbital-derived field stays null rather than deriving anything from them.
  const flightPoint = getInterpolated<VesselFlightPayload>("vessel.flight");
  if (!flightPoint) return undefined; // not whole yet, no point at all
  if (flightPoint.payload === null) return null; // tombstone, vessel confirmed absent
  const flight = flightPoint.payload;

  // Body-name resolution needs only the index and the body table, no orbital propagation, so it is populated in the Loaded basis unlike the orbital-derived fields above.
  const identityPoint = get<VesselIdentityPayload>("vessel.identity");
  const parentBodyIndex =
    identityPoint && identityPoint.payload !== null
      ? identityPoint.payload.parentBodyIndex
      : null;

  return {
    /*
     * `finiteOrNull`, like every other derived scalar in this file. These two
     * come STRAIGHT off the wire rather than out of a computation, and `mag`
     * answers NaN for an absent field (see its own doc for why that is the
     * right answer THERE). NaN is neither of the two answers these fields
     * declare, and a consumer's `??` does not catch it: the readout still
     * renders as absent, but every threshold compared against it silently
     * stops firing.
     */
    altitudeAsl: finiteOrNull(mag(flight.altitudeAsl)),
    orbitalSpeed: finiteOrNull(mag(flight.orbitalSpeed)),
    met: missionElapsed(identityPoint, viewUt),
    period: null,
    trueAnomaly: null,
    apoapsisAlt: null,
    periapsisAlt: null,
    timeToAp: null,
    timeToPe: null,
    parentBodyName: resolveBodyName(get, parentBodyIndex),
    referenceBodyName: resolveBodyName(get, orbit.referenceBodyIndex),
    parentBodyRadius: resolveBodyRadius(get, parentBodyIndex),
    referenceBodyRadius: resolveBodyRadius(get, orbit.referenceBodyIndex),
    ...deriveEncounter(get, orbit),
    // Orbital-radius/next-apsis are OnRails-only (osculating garbage here),
    // same null posture as apoapsisAlt/timeToAp above.
    apoapsisRadius: null,
    periapsisRadius: null,
    orbitalRadius: null,
    nextApsisType: null,
    timeToNextApsis: null,
    // Horizontal speed is the measured-basis Pythagorean surface split, the
    // one new field that's LIVE here and null OnRails (the opposite split from
    // the orbital fields). Clamp before sqrt so FP noise never yields NaN.
    horizontalSpeed: finiteOrNull(
      Math.sqrt(
        Math.max(
          0,
          mag(flight.surfaceSpeed) * mag(flight.surfaceSpeed) -
            mag(flight.verticalSpeed) * mag(flight.verticalSpeed),
        ),
      ),
    ),
    ...deriveEnumDisplayMaps(get),
    // Self-relative flags/derivations: independent of the kinematic basis.
    twr: deriveTwr(get),
    isControllable: deriveIsControllable(get),
    ...deriveIdentityFlags(get),
    // The ballistic impact prediction: LIVE here (measured basis).
    ...deriveLanding(get, orbit, flight, viewUt),
    orbitPatches: orbitPatchesLegacy,
    subjectId,
  };
}

/**
 * `vessel.state`'s own `StreamStatusValue` ("derived
 * channels propagate the worst input staleness into their own status").
 * Mirrors `deriveVesselState`'s own branching EXACTLY: worst of
 * ACTUALLY-consulted inputs, not worst of every declared input: the OnRails
 * basis never reads `vessel.flight` at all (see the "does not read
 * vessel.flight at all" test above), so a `vessel.flight` that's
 * held-stale/resyncing must not drag down an OnRails `vessel.state` reading
 * that has nothing to do with it. `getStatus`/`get` are threaded in by
 * `TimelineStore.sampleDerivedStatus`: same shape as `deriveVesselState`'s
 * own `(get, viewUt)`, plus the status lookup.
 *
 * `undefined`/`null` on the orbit input map straight onto `"resyncing"`/
 * `"absent"`: the orbit sample's OWN status already encodes exactly that
 * distinction (`sampleRawStatus`: no point at all -> `"resyncing"`,
 * tombstone -> `"absent"`), so returning it directly here reuses that
 * classification instead of re-deriving it from `get()`.
 */
export function deriveVesselStateStatus(
  getStatus: (topic: string) => StreamStatusValue,
  get: DerivedGet,
  _viewUt: number,
): StreamStatusValue {
  const orbitStatus = getStatus("vessel.orbit");
  if (orbitStatus === "resyncing" || orbitStatus === "absent") {
    return orbitStatus;
  }

  const orbitPoint = get<VesselOrbitPayload>("vessel.orbit");
  if (orbitPoint?.meta.quality === Quality.OnRails) return orbitStatus;

  // Loaded (or, defensively, an orbit point that's unexpectedly missing
  // despite a non-resyncing/absent status): vessel.flight is consulted too.
  return worstStatus([orbitStatus, getStatus("vessel.flight")]);
}

/**
 * Whether this record is forward-modelled, and on what.
 *
 * The OnRails basis solves the state vector, the anomalies and both
 * time-to-apsis figures from the orbital elements at the frame's view time
 * (`trySolve(elements, viewUt)`), and does so whether or not anything has
 * arrived recently, because the elements are a CAUSE valid until superseded.
 * That is the right derivation and always was; what it lacked was a way to say
 * it. Without this, a craft twenty minutes dark served a propagated altitude on
 * the `stale` arm, whose own doc promises "the last REAL observation, never a
 * modelled value".
 *
 * The Loaded/measured basis returns nothing: those fields come off
 * `vessel.flight` by interpolation between two real samples, which is a
 * statement about the interval between them and not a model of what happened
 * after the last one. Once contact is lost there is nothing left to
 * interpolate, so the reading is honestly stale.
 *
 * ## The horizon: the patch the elements describe, and nothing invented
 *
 * A conic does not decay. It is exactly as good after twenty minutes as after
 * one, which is why there is no age cutoff here and why inventing one would
 * replace a true model with a cliff. What a conic DOES have is an end: these
 * elements describe ONE patch, and the craft leaves it at the SOI transition
 * the wire already carries (`VesselOrbit.encounter.transitionUt`, the source of
 * `vessel.state.encounterUt`). Past that instant the elements are a statement
 * about an orbit around a body the craft is no longer near, so the model
 * declines and the reading falls back to `stale`.
 *
 * That closes the gap this doc used to record as unclosed, with a UT off the
 * wire rather than a constant.
 *
 * `transitionType` is deliberately not consulted. An escape and an encounter
 * both end this patch, and the horizon is the instant, not the kind.
 *
 * ## The second horizon: the air
 *
 * A patch also ends where the vacuum does. `kepler-propagation` names three
 * things it cannot survive and drag is the third, so an arc carried below the
 * entry interface is not a conic getting worse with age: it is a conic
 * describing a trajectory that is not happening. The failure is worst exactly
 * where an operator leans on it hardest, a re-entry, and it is invisible,
 * because a conic through air draws the same confident dashes a conic through
 * vacuum draws. `keplerAdmissibility`'s `entryInterfaceRadius` supplies the
 * floor and the check is the solved radius against it, asked per instant, so
 * the tail simply stops there.
 *
 * **Declining takes positive evidence.** With no body roster there is no
 * interface to have crossed, and refusing on an absent fact would blank every
 * propagated reading for the frames before a once-a-second channel lands. Same
 * posture the SOI horizon above already takes on an absent `encounter`, and the
 * same one the delay model takes in declaring a command lost: a withdrawal is
 * asserted on evidence, never on the lack of it.
 *
 * ## What is still unbounded, and cannot be bounded here
 *
 * A BURN. A craft out of contact is exactly one whose burns we cannot see, so
 * nothing inside this function can bound it, and the `kepler-propagation`
 * basis carries that caveat in its own words. That is what a basis is for.
 *
 * ## Why this is not a `registerReckoner` registration
 *
 * Because it cannot be, and because the arm it is on is not the lesser one.
 *
 * `registerReckoner` takes a `TopicId`, and `vessel.state` is a
 * `DerivedChannelId`: a separate union with no wire payload for `TopicPayload`
 * to resolve, because a derived channel is computed in the browser and has no
 * `[SitrepTopic]` type behind it. `registerReckoner("vessel.state", ...)` is a
 * compile error today, asserted from both sides in `reckoners.test-d.ts` so
 * that widening the parameter fails typecheck rather than passing quietly.
 *
 * Nor would widening it buy the thing it looks like it would buy. The
 * generated reckonability map is emitted from `[SitrepReckonable]` marks on
 * C# contract properties, so a channel with no C# payload cannot appear in it
 * whichever seam declares the model: `use-telemetry.ts` says so where it
 * explains why a derived channel needs the middle arm of its three-way
 * narrowing at all.
 *
 * What a registration WOULD have to supply is a `reckon(at)` producing the
 * record at an arbitrary instant, and that already exists one level up:
 * `TimelineStore.derivedReckonedWalk` re-runs `derive` at each instant of a
 * tail against hold-last inputs, and labels the result with this function. So
 * a derived channel's model is a full forward model, expressed as `derive` plus
 * this label rather than as one function, and `derivedReckoner` adapts the pair
 * into the same `ReckonerFor` the registry hands out. Two arms of one seam, not
 * an old mechanism and a new one.
 *
 * The one thing the derived arm genuinely lacks is the store's input rules:
 * nothing withdraws this label because a declared input ran past its own
 * model's horizon. It does not bite here, because the four conditions
 * `keplerAdmissibility` asks ARE that check for the only inputs this label has,
 * asked against the same published facts a registered model would name. A
 * derived channel that grew an input whose horizon it did not itself consult
 * would be the case that wants revisiting.
 */
export function deriveVesselStateReckoning(
  get: DerivedGet,
  viewUt: number,
): readonly ModelledField[] | undefined {
  /*
   * All four withdrawal conditions moved to `keplerAdmissibility`, and this
   * function is now the thin half: it asks the same question core's registered
   * reckoners ask and turns the answer into this channel's field list. The
   * conditions and the arithmetic they guard live once, so a registered model
   * and this channel cannot come to disagree about where the conic ends.
   */
  const admissible = keplerAdmissibility(
    get<VesselOrbitPayload>("vessel.orbit"),
    get<SystemBodiesPayload>("system.bodies")?.payload ?? undefined,
    viewUt,
  );
  return "declined" in admissible ? undefined : KEPLER_MODELLED_FIELDS;
}

/**
 * What the conic MOVES, path by path, beside the record-wide claim.
 *
 * The root entry is the record: `derive` ran for this frame's view time, so
 * every field on it is that run's answer, which is what a whole-topic read and
 * a scalar readout beside its own age are asking. The named entries are the
 * narrower claim, and the difference bites wherever a caller draws a SHAPE
 * rather than a number. `sampleReckonedTail` will only carry a path named here,
 * so a chart of `twr` (carried verbatim off a `vessel.propulsion` sample
 * nothing propagated) stops at the last observation instead of growing a dashed
 * run attributed to a model that never touched it.
 *
 * The list is what `trySolve`/`trySolveAnomalies` and their dependents produce
 * from `viewUt`, read off the OnRails branch of `deriveVesselState` directly.
 *
 * Two deliberate absences:
 *
 * - `period`, both apsis ALTITUDES and both apsis RADII are constants OF the
 *   conic. They are true for the whole propagation and no part of them is a
 *   function of the instant, so a chart of one draws a flat line whether it is
 *   named here or not, and naming it would call a constant a propagation
 * - `met` advances at exactly one second per second whether or not anybody is
 *   listening. It is a clock, not a model, and stamping `kepler-propagation` on
 *   elapsed time misdescribes what produced it
 */
const KEPLER_MODELLED_FIELDS: readonly ModelledField[] = [
  { path: "", basis: "kepler-propagation" },
  { path: "orbitalSpeed", basis: "kepler-propagation" },
  { path: "orbitalRadius", basis: "kepler-propagation" },
  { path: "altitudeAsl", basis: "kepler-propagation" },
  { path: "trueAnomaly", basis: "kepler-propagation" },
  { path: "timeToAp", basis: "kepler-propagation" },
  { path: "timeToPe", basis: "kepler-propagation" },
  { path: "timeToNextApsis", basis: "kepler-propagation" },
  { path: "nextApsisType", basis: "kepler-propagation" },
];

/**
 * Ready-to-register definition: `store.registerDerivedChannel(vesselStateChannel)`.
 * `fields: true` exposes `vessel.state.<field>` subtopics (e.g.
 * `vessel.state.altitudeAsl`) reading off this one memoized record, per
 * `TimelineStore`'s field-subtopic mechanism.
 *
 * `inputs` is NOT just documentation: the carried-channels gate
 * (`carried-channels.ts`'s `isTopicCarried`, via
 * `TimelineStore.resolveSubscriptionTopics`) is PARENT-CHANNEL-scoped, not
 * per-field, so a consumer of ANY `vessel.state.*` field is "carried" only
 * once EVERY input listed here is in its `carriedChannels` allowlist, not
 * just the ones the particular field it reads actually consults. An input
 * consulted through `get()` without being declared here reads as "carried"
 * while never actually subscribing, which is a PERMANENT stuck `undefined`:
 * the "big-bang blank-out" class of bug the gate exists to prevent (see
 * `carried-channels.ts`'s own doc comment). A declared-but-quiet input costs
 * nothing, so the list errs towards declaring.
 */
export const vesselStateChannel: DerivedChannelDefinition<VesselState> = {
  topic: "vessel.state",
  /*
   * `vessel.orbit` and `vessel.flight` are the kinematic pair the record is
   * built on, and the only two `deriveVesselStateStatus` reads. The rest each
   * feed a single field or a small group of them (`system.bodies` the body
   * names and radii, `vessel.identity` MET and the identity flags,
   * `vessel.control` the SAS-mode name, `vessel.comms` the control state,
   * `vessel.propulsion` TWR), and an absent one nulls just those, never the
   * whole record and never the status.
   */
  inputs: [
    "vessel.orbit",
    "vessel.flight",
    "vessel.identity",
    "system.bodies",
    "vessel.control",
    "vessel.comms",
    "vessel.propulsion",
  ],
  derive: deriveVesselState,
  deriveStatus: deriveVesselStateStatus,
  deriveReckoning: deriveVesselStateReckoning,
  fields: true,
};

/**
 * How one `vessel.state` field is described: a scalar's unit, a vector whose
 * unit belongs to each component, or a collection with no unit of its own.
 */
type VesselStateFieldShape =
  | { readonly unit: SitrepUnit }
  | { readonly vector: SitrepUnit }
  | { readonly collection: string };

/**
 * What each `vessel.state` field MEANS, in the contract's own unit vocabulary.
 *
 * This channel is computed client-side, so no `[SitrepTopic]` type exists for
 * the unit-map codegen to reflect over and the generated maps know nothing
 * about it. Every other Topic can be enumerated from those maps; without this
 * the most-declared channel in the tree, and the one carrying the bulk of what
 * an operator sets a threshold on, is the one a key picker cannot describe.
 * `HAND_DECLARED_PAYLOAD_TYPES` in `units.ts` answers the same question for a
 * Topic whose payload type the codegen cannot see.
 *
 * `Record<keyof VesselState, ...>` rather than a free-form map, so the COMPILER
 * keeps this complete: a field added to the interface above fails the build
 * until it is described here, and a name that is not a field of it is rejected.
 * That is the whole guarantee, and it is why there is no fixture to go stale
 * and no source scan to silently match nothing.
 *
 * The payload carries bare magnitudes rather than `Value`s: the derivations
 * above compute numbers, and nothing wraps a derived channel (the wrap runs on
 * decoded WIRE frames). So this records what a field means, which is what an
 * enumeration and a display need, and does not claim the field arrives wrapped.
 */
export const VESSEL_STATE_FIELDS: Readonly<
  Record<keyof VesselState, VesselStateFieldShape>
> = {
  altitudeAsl: { unit: "m" },
  apoapsisAlt: { unit: "m" },
  apoapsisRadius: { unit: "m" },
  commsControlStateName: { unit: "text" },
  commsControlStateOrdinal: { unit: "enum" },
  encounterBody: { unit: "text" },
  // A -1/0/1 sign encoding escape / none / encounter, not a count of them.
  encounterExists: { unit: "enum" },
  // An instant on the universal clock, never an interval: a countdown refuses a
  // UT, and a duration renderer would read this as that many seconds.
  encounterUt: { unit: "ut" },
  horizontalSpeed: { unit: "m/s" },
  isControllable: { unit: "flag" },
  isEVA: { unit: "flag" },
  isSplashed: { unit: "flag" },
  landingPredictedLat: { unit: "°" },
  landingPredictedLon: { unit: "°" },
  met: { unit: "s" },
  nextApsisType: { unit: "enum" },
  orbitalRadius: { unit: "m" },
  orbitalSpeed: { unit: "m/s" },
  parentBodyName: { unit: "text" },
  periapsisAlt: { unit: "m" },
  periapsisRadius: { unit: "m" },
  period: { unit: "s" },
  referenceBodyName: { unit: "text" },
  parentBodyRadius: { unit: "m" },
  referenceBodyRadius: { unit: "m" },
  sasModeName: { unit: "text" },
  situationName: { unit: "text" },
  subjectId: { unit: "id" },
  timeToAp: { unit: "s" },
  timeToNextApsis: { unit: "s" },
  timeToPe: { unit: "s" },
  trueAnomaly: { unit: "°" },
  // A thrust-to-weight ratio is dimensionless, which is not the same as having
  // no unit: the explicit token says so.
  twr: { unit: "1" },
  orbitPatches: { collection: "OrbitPatch[]" },
};

/**
 * Flattens the declaration above into the two maps the units registry holds. A
 * vector's unit lands on dotted leaf keys, the convention the generated map uses
 * for a vector field, because the leaves are what a reader indexes.
 */
function vesselStateUnitMaps(): {
  units: UnitsByField;
  shapes: ShapesByField;
} {
  const units: Record<string, SitrepUnit> = {};
  const shapes: Record<string, string> = {};
  for (const [field, declared] of Object.entries(VESSEL_STATE_FIELDS)) {
    if ("collection" in declared) {
      shapes[field] = declared.collection;
    } else if ("vector" in declared) {
      for (const axis of ["x", "y", "z"]) {
        units[`${field}.${axis}`] = declared.vector;
      }
    } else {
      units[field] = declared.unit;
    }
  }
  return { units, shapes };
}

const VESSEL_STATE_UNIT_MAPS = vesselStateUnitMaps();

registerTopicUnits(
  "vessel.state",
  VESSEL_STATE_UNIT_MAPS.units,
  VESSEL_STATE_UNIT_MAPS.shapes,
);
