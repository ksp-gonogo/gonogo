import { Quality } from "@gonogo/sitrep-sdk";
import type { OrbitElements, Vector3 } from "./kepler";
import { solve, solveAnomalies } from "./kepler";
import type { StreamStatusValue } from "./stream-status";
import { worstStatus } from "./stream-status";
import type { DerivedChannelDefinition, DerivedGet } from "./timeline-store";

/**
 * The canonical `{x,y,z}` vector shape every `vessel.target`/`vessel.dock`
 * Vec3 field carries on the wire (`mod/Sitrep.Contract/Vec3.cs`).
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * One upcoming SOI patch transition — the `vessel.orbit.encounter` nullable
 * record (`mod/Sitrep.Contract/VesselOrbit.cs`'s `OrbitEncounter`). The whole
 * record is `null` when there's no upcoming SOI transition on the current
 * trajectory (the common case) — never a sentinel.
 *
 * `transitionType` is the raw `Sitrep.Contract.TransitionType` enum ORDINAL on
 * the wire (Initial 0 / Final 1 / Encounter 2 / Escape 3 / Maneuver 4 /
 * Collision 5 / Unknown 6 — VesselEnums.cs); `transitionUt` is the UT-seconds
 * of the transition; `bodyIndex` is the `system.bodies` index of the body
 * being transitioned INTO (`null` if it couldn't be resolved).
 */
export interface OrbitEncounterPayload {
  transitionType: number;
  transitionUt: number;
  bodyIndex: number | null;
}

/**
 * The `vessel.orbit` channel payload — elements, never position (M2 design
 * §2.4, mirrors `mod/Sitrep.Contract/VesselOrbit.cs`). Not yet codegen'd into
 * `@gonogo/sitrep-sdk`'s `__generated__/contract.ts` (that's the mod-side
 * channel-payload codegen, out of this task's scope) — hand-mirrored here so
 * `deriveVesselState` has a typed shape to read. Keep in sync with the C#
 * source until codegen catches up.
 *
 * Units, verbatim from the C# doc comment: `sma` in metres; `inc`/`lan`/
 * `argPe` in DEGREES (KSP-native); `meanAnomalyAtEpoch` in RADIANS (also
 * KSP-native) — an inherited KSP inconsistency, deliberately kept. `lan`/
 * `argPe` are `null` for an undefined ascending node / periapsis (near-
 * equatorial / near-circular orbits) — never NaN, never a fake 0.
 */
export interface VesselOrbitPayload {
  referenceBodyIndex: number;
  sma: number;
  ecc: number;
  inc: number;
  lan: number | null;
  argPe: number | null;
  meanAnomalyAtEpoch: number;
  epoch: number;
  mu: number;
  /**
   * The next upcoming SOI transition, or `null` when there is none (the
   * common case) — the source of `vessel.state.encounterExists`/
   * `encounterBody`/`encounterTime` (old Telemachus `o.encounterExists`/
   * `o.encounterBody`/`o.encounterTime`). Optional here because it's an
   * additive field the reference wire fixture / older recordings may not
   * carry yet — treated identically to `null` (no encounter).
   */
  encounter?: OrbitEncounterPayload | null;
}

/**
 * The `vessel.flight` channel payload — measurements, not evaluations
 * (mirrors `mod/Sitrep.Contract/VesselFlight.cs`). Same hand-mirroring note
 * as `VesselOrbitPayload` above.
 */
export interface VesselFlightPayload {
  latitude: number;
  longitude: number;
  altitudeAsl: number;
  altitudeTerrain: number;
  verticalSpeed: number;
  surfaceSpeed: number;
  orbitalSpeed: number;
  gForce: number;
  dynamicPressureKPa: number;
  mach: number;
  atmDensity: number;
}

/**
 * The `vessel.identity` channel payload — hand-mirrored subset relevant to
 * `deriveVesselState`'s `met` field (mirrors `mod/Sitrep.Contract/
 * VesselIdentity.cs`; envelope `Meta`, same as `VesselOrbitPayload`/
 * `VesselFlightPayload` above, is not part of this payload shape). `vesselType`/
 * `situation` are the raw C# enum ordinals on the wire (no TS enum exists yet
 * for either — see `map-topic.ts`'s note on `v.situationString`).
 *
 * `launchUt`: sampleUt - missionTime; `null` before the vessel's launch clock
 * has started (see the C# class doc) — the source of `VesselState.met`'s own
 * `null`-before-launch case.
 */
export interface VesselIdentityPayload {
  vesselId: string;
  name: string;
  vesselType: number;
  situation: number;
  parentBodyIndex: number | null;
  launchUt: number | null;
}

/**
 * The `vessel.control` channel payload — hand-mirrored subset relevant to the
 * `sasModeName` display map (mirrors `mod/Sitrep.Contract/VesselControl.cs`).
 * `sasMode` is the raw `Sitrep.Contract.SasMode` enum ORDINAL on the wire
 * (`VesselViewProvider` serializes `(int)control.SasMode`), individually
 * nullable — `null` is a normal "this input isn't available this tick" per the
 * C# class doc (R1(a)), NOT a sentinel.
 */
export interface VesselControlPayload {
  sasMode: number | null;
}

/**
 * The `vessel.target` channel payload — hand-mirrored subset relevant to the
 * `targetKind` display map (mirrors `mod/Sitrep.Contract/VesselTarget.cs`).
 * `kind` is the raw `Sitrep.Contract.TargetKind` enum ORDINAL on the wire
 * (`(int)target.Kind`). The WHOLE channel is absent (no point) when nothing is
 * targeted (R1(b)) — the common case — never a sentinel record.
 *
 * `relativePosition`/`relativeVelocity` are the canonical `Vec3` fields
 * (metres / m/s, self-relative), each individually `null` when the transform
 * data needed to compute it wasn't available this tick (R7). They're the
 * source of `vessel.state.targetRelativeSpeed` — the signed range-rate behind
 * the old Telemachus scalar `tar.o.relativeVelocity`.
 */
export interface VesselTargetPayload {
  kind: number;
  relativePosition?: Vec3 | null;
  relativeVelocity?: Vec3 | null;
}

/**
 * The `vessel.comms` channel payload — hand-mirrored subset relevant to the
 * comms control-state display maps (mirrors `mod/Sitrep.Contract/
 * VesselComms.cs`). `controlState` is the raw `Sitrep.Contract.ControlState`
 * enum ORDINAL on the wire (`(int)comms.ControlState` in `VesselViewProvider`
 * — despite the old `map-topic.ts` gap comment calling it a "STRING enum", the
 * host serializes the integer, same as every other contract enum). The whole
 * channel is absent when `vessel.connection` is null (R1(b)).
 */
export interface VesselCommsPayload {
  controlState: number;
}

/** One body's orbital elements within `system.bodies` — `null` only for the root star (mirrors `SystemViewProvider.BuildOrbit`). Units match `VesselOrbitPayload`'s (degrees for inc/lan/argPe, radians for meanAnomalyAtEpoch). */
export interface SystemBodyOrbitPayload {
  sma: number | null;
  ecc: number | null;
  inc: number | null;
  lan: number | null;
  argPe: number | null;
  meanAnomalyAtEpoch: number | null;
  epoch: number | null;
}

/** One entry in the `system.bodies` array (mirrors `SystemViewProvider.BuildBody`). `index` — not array position — is the stable id `vessel.orbit.referenceBodyIndex`/`vessel.identity.parentBodyIndex` point at. */
export interface SystemBodyPayload {
  name: string | null;
  index: number;
  parentIndex: number | null;
  /** Mean radius, metres. `null` when the live game hasn't reported it yet. */
  radius: number | null;
  orbit: SystemBodyOrbitPayload | null;
}

/** The `system.bodies` channel payload (mirrors `SystemViewProvider.BuildSystemBodies`'s `{ "bodies": [...] }` shape) — the source of `VesselState.apoapsisAlt`/`periapsisAlt`'s reference-body radius. */
export interface SystemBodiesPayload {
  bodies: SystemBodyPayload[];
}

/**
 * The quality-picked, widget-facing kinematic surface (M2 design §2.4; M1
 * §6.2/§8.2's `vessel.state` obligation — the V-12 dual-altitude fix).
 *
 * Scope note: the original T3 cut derived ONLY from `vessel.orbit` +
 * `vessel.flight` (no `system.bodies`/`vessel.identity` inputs), so fields
 * needing body geometry or the launch clock were out of scope. This M3 task
 * adds seven fields that ARE derivable from already-served data —
 * `met`/`period`/`trueAnomaly`/`apoapsisAlt`/`periapsisAlt`/`timeToAp`/
 * `timeToPe` — reading `vessel.identity` (for `met`'s `launchUt`) and
 * `system.bodies` (for the apsides' reference-body radius) alongside the
 * original two inputs. `altitude-from-propagated-position`/`lat-long-from-
 * rotation` still need more than these seven do and remain deferred.
 * `altitudeAsl`/`verticalSpeed`/`surfaceSpeed` are populated only in the
 * "measured" (Loaded) basis, straight off `vessel.flight` — see
 * `deriveVesselState`'s doc for why the "propagated" (OnRails) basis leaves
 * them `null` rather than fabricating a body-less approximation. The seven
 * new fields below take the OPPOSITE split — orbital-elements-derived, so
 * they're OnRails-only and `null` in the "measured" basis, same reasoning
 * (Loaded-basis orbital elements are osculating garbage, not a trajectory
 * worth deriving a period/apsis/anomaly from — this file's own doc on the
 * OnRails/Loaded branches explains the "osculating garbage" call).
 */
export interface VesselState {
  /** Parent-body-relative, metres. `null` in the "measured" basis — `vessel.flight` carries no position vector (needs `system.bodies` to reconstruct one; deferred). */
  position: Vector3 | null;
  /** Parent-body-relative, m/s. `null` in the "measured" basis, same reason as `position`. */
  velocity: Vector3 | null;
  /** Metres above sea level. `null` in the "propagated" basis (needs `system.bodies` radius; deferred) — always sourced from `vessel.flight.altitudeAsl` in the "measured" basis. */
  altitudeAsl: number | null;
  verticalSpeed: number | null;
  surfaceSpeed: number | null;
  /** m/s. Populated in BOTH bases: propagated from `|velocity|` when on-rails, taken straight from `vessel.flight.orbitalSpeed` when loaded. */
  orbitalSpeed: number | null;
  /**
   * Mission elapsed time, seconds: `viewUt - vessel.identity.launchUt`.
   * OnRails basis only (see class doc); `null` in the "measured" basis,
   * before launch (`launchUt` still `null` on `vessel.identity`), while
   * `vessel.identity` hasn't arrived yet (a secondary input — its absence
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
   * True anomaly at `viewUt`, DEGREES wrapped to [0, 360) — the Telemachus/
   * KSP widget-facing convention (`vessel.orbit.inc`/`argPe`'s own
   * precedent; `kepler.ts`'s internal radians are converted at this
   * boundary, never leaked past it). OnRails basis only; `null` in the
   * "measured" basis. Reuses `kepler.solveAnomalies` — never a second Kepler
   * solve.
   */
  trueAnomaly: number | null;
  /**
   * Apoapsis altitude above the reference body's mean radius, metres:
   * `sma·(1+ecc) - bodyRadius`. OnRails basis only. `undefined` while
   * `system.bodies` isn't whole yet, or is whole but doesn't (yet) carry the
   * referenced body's radius — both "still resyncing", never conflated with
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
   * wrapped forward — 0 if already there. OnRails basis only; `null` in the
   * "measured" basis or on a non-finite/non-positive mean motion.
   */
  timeToAp: number | null;
  /** Seconds from `viewUt` until the mean anomaly next reaches periapsis (0), wrapped forward. Same basis/finite-guard rules as `timeToAp`. */
  timeToPe: number | null;
  /**
   * Name of the body the vessel currently belongs to — the display-map
   * resolution of `vessel.identity.parentBodyIndex` against `system.bodies`
   * (the old Telemachus `v.body` string). Populated in BOTH bases (needs only
   * the index + the body table, no orbital propagation). `undefined` while
   * `vessel.identity` hasn't arrived, the index isn't resolvable yet (body or
   * its name not in `system.bodies` yet, or `system.bodies` itself not whole),
   * or there is no parent index at all; `null` when `system.bodies` is a
   * confirmed tombstone — same `undefined`-vs-`null` "still resyncing vs.
   * confirmed absent" discipline as `apoapsisAlt`/`periapsisAlt`.
   */
  parentBodyName: string | null | undefined;
  /**
   * Name of the vessel's orbit reference body — the display-map resolution of
   * `vessel.orbit.referenceBodyIndex` against `system.bodies` (the old
   * Telemachus `o.referenceBody` string). Populated in BOTH bases; same
   * `undefined`-vs-`null` rules as `parentBodyName`.
   */
  referenceBodyName: string | null | undefined;
  /**
   * Next-SOI-transition SIGN — the display-map resolution of
   * `vessel.orbit.encounter` to the -1/0/1 scalar OrbitalEventChips reads as
   * `o.encounterExists`: `1` = ENCOUNTER (entering another body's SOI —
   * `TransitionType.Encounter`), `-1` = ESCAPE (leaving the current SOI —
   * `TransitionType.Escape`), `0` = none (no encounter record, or a
   * transition type the chip doesn't surface: Initial/Final/Maneuver/
   * Collision/Unknown). `transitionType` DOES matter here — the widget keys
   * its encounter-vs-escape variant off the sign, so a plain boolean would
   * lose that distinction. `0` (a DEFINED "no encounter") whenever
   * `vessel.orbit` is present but carries no encounter — never `undefined`,
   * since `vessel.orbit`'s own presence already gates the whole record.
   * Populated in BOTH bases (KSP predicts patched-conic transitions
   * regardless of on-rails/loaded).
   */
  encounterExists: number | null | undefined;
  /**
   * Encounter body NAME — `vessel.orbit.encounter.bodyIndex` resolved against
   * `system.bodies` (old Telemachus `o.encounterBody`). `undefined` when there
   * is no encounter, the index isn't resolvable yet, or `system.bodies` hasn't
   * arrived; `null` when `system.bodies` is a confirmed tombstone. Same
   * `resolveBodyName` discipline as `parentBodyName`.
   */
  encounterBody: string | null | undefined;
  /**
   * Encounter time — `vessel.orbit.encounter.transitionUt` (UT seconds), the
   * old Telemachus `o.encounterTime`. `undefined` when there is no encounter
   * or the value is non-finite. The widget only shows the chip when this is a
   * finite number > 0.
   */
  encounterTime: number | null | undefined;
  /**
   * Signed target closing/opening rate, m/s — the range-rate
   * `dot(relativePosition, relativeVelocity) / |relativePosition|` derived from
   * `vessel.target`'s two Vec3 fields, the new home for the old Telemachus
   * scalar `tar.o.relativeVelocity`. Sign follows the standard KSP convention
   * DistanceToTarget/TargetPicker were written against: POSITIVE = opening
   * (gap growing), NEGATIVE = closing (the widgets' `< 0` = closing check).
   * Populated in BOTH bases (self-relative kinematics, not orbital-elements
   * derived). `undefined` when `vessel.target` hasn't arrived, either vector
   * isn't available this tick, or `|relativePosition|` is ~0 (no line of sight
   * to project onto — never divides by zero); `null` on a confirmed tombstone.
   */
  targetRelativeSpeed: number | null | undefined;
  /**
   * Situation NAME — the display-map resolution of `vessel.identity.situation`
   * (a numeric `Sitrep.Contract.Situation` enum ordinal on the wire) to its
   * enum name string ("Landed", "Orbiting", …), the new home for the old
   * Telemachus `v.situationString` string ScienceBench renders. Populated in
   * BOTH bases (needs only `vessel.identity`, no propagation). `undefined`
   * while `vessel.identity` hasn't arrived or the ordinal is out of the enum's
   * range (unrecognized — "still resyncing"); `null` when `vessel.identity` is
   * a confirmed tombstone. `Situation.Unknown` (ordinal 8) is a DEFINED value
   * and resolves to the literal name "Unknown", not `undefined`.
   */
  situationName: string | null | undefined;
  /**
   * SAS-mode NAME — the display-map resolution of `vessel.control.sasMode` (a
   * numeric `Sitrep.Contract.SasMode` enum ordinal) to its enum name string,
   * the new home for the old Telemachus `f.sasMode` string. The names match
   * Navball's `SAS_MODES` union EXACTLY (both mirror KSP's
   * `VesselAutopilot.AutopilotMode` order), so the widget's `sasMode === mode`
   * active-button compare works unchanged. Populated in BOTH bases.
   * `undefined` while `vessel.control` hasn't arrived, when `sasMode` is `null`
   * (not available this tick), or when the ordinal is out of range; `null`
   * when `vessel.control` is a confirmed tombstone. `SasMode.Unknown` (ordinal
   * 10) resolves to "Unknown" (not in `SAS_MODES`, so no button highlights —
   * the same benign outcome as the legacy path).
   */
  sasModeName: string | null | undefined;
  /**
   * Target KIND string — the display-map resolution of `vessel.target.kind` (a
   * numeric `Sitrep.Contract.TargetKind` enum ordinal: Vessel/Body/Other) to
   * the string set TargetPicker/DistanceToTarget were written against, the new
   * home for the old Telemachus `tar.type`. NOTE the deliberate
   * NORMALIZATION: TargetKind's `Body` is mapped to the literal
   * `"CelestialBody"` (not the C# name "Body"), because DistanceToTarget's
   * dockable gate is a literal `tarType !== "CelestialBody"` compare against
   * the legacy string — emitting "Body" would silently misclassify every
   * body as dockable. `Vessel`→"Vessel", `Other`→"Other". (Coarser than
   * legacy Telemachus, which returned the specific VesselType name e.g.
   * "Station" for a vessel target — an inherent, documented coarsening of the
   * `TargetKind` contract; the dockable gate is unaffected.) `undefined` when
   * `vessel.target` is absent (nothing targeted — the common case) or the
   * ordinal is out of range; `null` on a confirmed tombstone.
   */
  targetKind: string | null | undefined;
  /**
   * Comms control-state NAME — the display-map resolution of
   * `vessel.comms.controlState` (a numeric `Sitrep.Contract.ControlState` enum
   * ordinal) to its enum name string ("None", "Partial", "Full", "ProbeFull",
   * …), the new home for the old Telemachus `comm.controlStateName` string
   * CommSignal prefers for its label + tone. `undefined` while `vessel.comms`
   * hasn't arrived or the ordinal is out of range; `null` on a confirmed
   * tombstone. `ControlState.Unknown` (ordinal 11) resolves to "Unknown".
   */
  commsControlStateName: string | null | undefined;
  /**
   * Comms control-state ORDINAL in CommSignal's Telemachus 0/1/2 scheme
   * (0=none, 1=partial, 2=full) — the new home for the old Telemachus numeric
   * `comm.controlState`, DERIVED from `vessel.comms.controlState`'s
   * `Sitrep.Contract.ControlState` enum by collapsing its 11 richer values
   * onto the three control LEVELS CommSignal branches on (bars fallback +
   * hasData): any `*Full`/bare `Probe`/`Kerbal` → 2, any `*Partial` → 1, any
   * `*None`/bare `None` → 0. `undefined` while `vessel.comms` hasn't arrived,
   * for `ControlState.Unknown`, or an out-of-range ordinal; `null` on a
   * confirmed tombstone.
   */
  commsControlStateOrdinal: number | null | undefined;
  /** Which path produced this record's kinematics — never a widget's choice (M1 §6.2's V-12 fix). */
  basis: "propagated" | "measured";
  /** `vessel:<guid>` — subject provenance, from the orbit sample's envelope `meta.source` (M1 §6.1). */
  subjectId: string;
}

function magnitude(v: Vector3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Wraps a degree value into [0, 360) — the Telemachus/KSP widget-facing angle convention (contrast `kepler.ts`'s internal [0, 2π) radian wrap). */
function wrapDegrees360(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** `x` if finite, else `null` — the discipline every new derived scalar field in this file follows (never a NaN/Infinity escapes onto `VesselState`). */
function finiteOrNull(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

/**
 * Seconds from `meanAnomaly` (radians) until the mean anomaly next reaches
 * `targetMeanAnomaly` (radians), wrapped forward to `[0, period)` — 0 when
 * already there. `null` for a non-finite or non-positive `meanMotion` (never
 * divide by zero/negative — a degenerate orbit has no well-defined period to
 * count down within).
 */
function timeToMeanAnomaly(
  meanAnomaly: number,
  targetMeanAnomaly: number,
  meanMotion: number,
): number | null {
  if (
    !Number.isFinite(meanAnomaly) ||
    !Number.isFinite(targetMeanAnomaly) ||
    !Number.isFinite(meanMotion) ||
    meanMotion <= 0
  ) {
    return null;
  }
  const twoPi = 2 * Math.PI;
  let delta = (targetMeanAnomaly - meanAnomaly) % twoPi;
  if (delta < 0) delta += twoPi;
  return delta / meanMotion;
}

/**
 * The apoapsis/periapsis altitude pair — needs the reference body's mean
 * radius from `system.bodies`, looked up by `orbit.referenceBodyIndex`
 * (`SystemBodyPayload.index`, the STABLE id, never array position). Kept as
 * its own function so `deriveVesselState`'s OnRails branch reads as a flat
 * list of field computations rather than an inline `system.bodies`-walking
 * block.
 *
 * `undefined` (not whole yet — "still resyncing") both when `system.bodies`
 * itself hasn't arrived and when it HAS arrived but the referenced body (or
 * its radius specifically) isn't in it yet — neither is a confirmed absence.
 * `null` only when `system.bodies` is an outright tombstone (the channel's
 * own confirmed-absent case, per the class-level `undefined`-vs-`null`
 * discipline applied here at the field level).
 */
function deriveApsides(
  get: DerivedGet,
  orbit: VesselOrbitPayload,
): {
  apoapsisAlt: number | null | undefined;
  periapsisAlt: number | null | undefined;
} {
  const bodiesPoint = get<SystemBodiesPayload>("system.bodies");
  if (!bodiesPoint) {
    return { apoapsisAlt: undefined, periapsisAlt: undefined };
  }
  if (bodiesPoint.payload === null) {
    return { apoapsisAlt: null, periapsisAlt: null };
  }

  const body = bodiesPoint.payload.bodies.find(
    (b) => b.index === orbit.referenceBodyIndex,
  );
  const radius = body?.radius;
  if (radius == null) {
    return { apoapsisAlt: undefined, periapsisAlt: undefined };
  }

  return {
    apoapsisAlt: finiteOrNull(orbit.sma * (1 + orbit.ecc) - radius),
    periapsisAlt: finiteOrNull(orbit.sma * (1 - orbit.ecc) - radius),
  };
}

/**
 * Resolve a body INDEX (the stable `SystemBodyPayload.index`, never array
 * position) to its NAME string via `system.bodies` — the client-side
 * display-map behind `vessel.state.parentBodyName`/`referenceBodyName`, the
 * new homes for the old Telemachus `v.body`/`o.referenceBody` name strings
 * (`map-topic.ts`). Mirrors `deriveApsides`'s `undefined`-vs-`null`
 * discipline:
 * - `undefined` ("still resyncing / not resolvable yet") when there's no
 *   index to resolve (`null`/`undefined` — e.g. `vessel.identity` absent, or
 *   a body with no parent), when `system.bodies` hasn't arrived, or when it
 *   HAS arrived but the referenced body (or its name specifically) isn't in
 *   it yet.
 * - `null` only when `system.bodies` is an outright tombstone — a confirmed
 *   absence.
 * Never throws on a missing index / missing table (the "not-yet-loaded" case
 * the migration task calls out explicitly).
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
 * (`o.encounterExists`/`o.encounterBody`/`o.encounterTime`). `orbit` is always
 * present here (its channel gates the whole `vessel.state` record), so a
 * missing/`null` encounter is a DEFINED "no encounter" — `encounterExists` 0,
 * body/time `undefined` — never the whole-record `undefined`/`null`. The body
 * NAME follows `resolveBodyName`'s `undefined`-vs-`null` discipline against
 * `system.bodies`. Never throws on a missing encounter / missing body table.
 */
function deriveEncounter(
  get: DerivedGet,
  orbit: VesselOrbitPayload,
): {
  encounterExists: number | null | undefined;
  encounterBody: string | null | undefined;
  encounterTime: number | null | undefined;
} {
  const encounter = orbit.encounter;
  if (encounter == null) {
    return {
      encounterExists: 0,
      encounterBody: undefined,
      encounterTime: undefined,
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
    encounterTime: Number.isFinite(encounter.transitionUt)
      ? encounter.transitionUt
      : undefined,
  };
}

/**
 * Signed target range-rate (`vessel.state.targetRelativeSpeed`, old
 * `tar.o.relativeVelocity`) = `dot(relPos, relVel) / |relPos|` — POSITIVE when
 * the target is receding (opening), NEGATIVE when closing, matching the
 * widgets' `< 0` = closing convention. Same channel-presence discipline as
 * `resolveEnumName`: `undefined` when `vessel.target` hasn't arrived, either
 * Vec3 isn't available this tick, `|relPos|` is ~0 (no unit vector to project
 * onto — never divides by zero), or the result is non-finite; `null` on a
 * confirmed tombstone.
 */
function deriveTargetRelativeSpeed(get: DerivedGet): number | null | undefined {
  const point = get<VesselTargetPayload>("vessel.target");
  if (!point) return undefined;
  if (point.payload === null) return null;
  const { relativePosition: p, relativeVelocity: v } = point.payload;
  if (p == null || v == null) return undefined;
  const distance = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
  if (distance === 0) return undefined;
  const dot = p.x * v.x + p.y * v.y + p.z * v.z;
  const rangeRate = dot / distance;
  return Number.isFinite(rangeRate) ? rangeRate : undefined;
}

/**
 * `Sitrep.Contract.Situation` names in C# declaration order (VesselEnums.cs).
 * The wire carries `(int)id.Situation`; this is the ordinal→name table behind
 * `vessel.state.situationName` (old Telemachus `v.situationString`).
 */
const SITUATION_NAMES: readonly string[] = [
  "Landed", // 0
  "Splashed", // 1
  "PreLaunch", // 2
  "Orbiting", // 3
  "Escaping", // 4
  "Flying", // 5
  "SubOrbital", // 6
  "Docked", // 7
  "Unknown", // 8
];

/**
 * `Sitrep.Contract.SasMode` names in C# declaration order (VesselControl.cs) —
 * identical to Navball's `SAS_MODES` union (both mirror KSP's
 * `VesselAutopilot.AutopilotMode`), with `Unknown` (10) the graceful fallback
 * not present in `SAS_MODES`. Behind `vessel.state.sasModeName` (old `f.sasMode`).
 */
const SAS_MODE_NAMES: readonly string[] = [
  "StabilityAssist", // 0
  "Prograde", // 1
  "Retrograde", // 2
  "Normal", // 3
  "Antinormal", // 4
  "RadialIn", // 5
  "RadialOut", // 6
  "Target", // 7
  "AntiTarget", // 8
  "Maneuver", // 9
  "Unknown", // 10
];

/**
 * `Sitrep.Contract.TargetKind` (VesselTarget.cs) → the string set the widgets
 * were written against. Index = the C# enum ordinal (Vessel 0 / Body 1 /
 * Other 2). Body is deliberately NORMALIZED to "CelestialBody" (the legacy
 * Telemachus string DistanceToTarget's dockable gate compares against) — see
 * `VesselState.targetKind`'s doc. Behind `vessel.state.targetKind` (old `tar.type`).
 */
const TARGET_KIND_NAMES: readonly string[] = [
  "Vessel", // 0
  "CelestialBody", // 1  (C# name is "Body" — normalized for the widgets)
  "Other", // 2
];

/**
 * `Sitrep.Contract.ControlState` names in C# declaration order (VesselComms.cs).
 * Behind `vessel.state.commsControlStateName` (old `comm.controlStateName`).
 */
const CONTROL_STATE_NAMES: readonly string[] = [
  "None", // 0
  "Probe", // 1
  "Kerbal", // 2
  "Partial", // 3
  "Full", // 4
  "ProbeNone", // 5
  "ProbePartial", // 6
  "ProbeFull", // 7
  "KerbalNone", // 8
  "KerbalPartial", // 9
  "KerbalFull", // 10
  "Unknown", // 11
];

/**
 * `ControlState` ordinal → CommSignal's Telemachus 0/1/2 control-LEVEL scheme
 * (behind `vessel.state.commsControlStateOrdinal`, old numeric
 * `comm.controlState`). Collapses the 11 richer states onto the three levels
 * the widget branches on: `*Full`/bare source → 2 (full), `*Partial` → 1,
 * `*None`/`None` → 0. `Unknown` (11) → `undefined` (unrecognized). Index-aligned
 * with `CONTROL_STATE_NAMES`.
 */
const CONTROL_STATE_LEVEL: readonly (number | undefined)[] = [
  0, // None
  2, // Probe (has probe control → full)
  2, // Kerbal (has crew control → full)
  1, // Partial
  2, // Full
  0, // ProbeNone
  1, // ProbePartial
  2, // ProbeFull
  0, // KerbalNone
  1, // KerbalPartial
  2, // KerbalFull
  undefined, // Unknown
];

/**
 * Generic enum-ordinal → NAME display-map resolver reading a single source
 * channel, mirroring `resolveBodyName`'s `undefined`-vs-`null` discipline:
 * `undefined` when the channel hasn't arrived (no point) or the ordinal is out
 * of the `names` table's range ("still resyncing / unrecognized"); `null` on a
 * confirmed tombstone. `ordinalOf` pulls the raw ordinal off the payload —
 * returning `null`/`undefined` for a field-level "not available this tick"
 * (mapped to `undefined`, never `null`, since it isn't a whole-channel
 * absence). Never throws on a missing channel / missing field.
 */
function resolveEnumName<T>(
  get: DerivedGet,
  topic: string,
  ordinalOf: (payload: T) => number | null | undefined,
  names: readonly string[],
): string | null | undefined {
  const point = get<T>(topic);
  if (!point) return undefined;
  if (point.payload === null) return null;
  const ordinal = ordinalOf(point.payload);
  if (ordinal == null) return undefined;
  return names[ordinal] ?? undefined;
}

/**
 * `vessel.comms.controlState`'s `ControlState` ordinal collapsed to CommSignal's
 * Telemachus 0/1/2 control-level scheme (`vessel.state.commsControlStateOrdinal`).
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
  return CONTROL_STATE_LEVEL[point.payload.controlState] ?? undefined;
}

/**
 * All five enum-ordinal display maps carried on `vessel.state` (migration
 * task 1–4: `v.situationString`/`f.sasMode`/`tar.type`/`comm.controlStateName`
 * + numeric `comm.controlState`). Bundled so both quality branches of
 * `deriveVesselState` populate them identically — each needs only its source
 * channel (`vessel.identity`/`vessel.control`/`vessel.target`/`vessel.comms`),
 * no orbital propagation, so they're live in the Loaded (measured) basis too,
 * same as the body-name display maps.
 */
function deriveEnumDisplayMaps(get: DerivedGet): {
  situationName: string | null | undefined;
  sasModeName: string | null | undefined;
  targetKind: string | null | undefined;
  commsControlStateName: string | null | undefined;
  commsControlStateOrdinal: number | null | undefined;
} {
  return {
    situationName: resolveEnumName<VesselIdentityPayload>(
      get,
      "vessel.identity",
      (p) => p.situation,
      SITUATION_NAMES,
    ),
    sasModeName: resolveEnumName<VesselControlPayload>(
      get,
      "vessel.control",
      (p) => p.sasMode,
      SAS_MODE_NAMES,
    ),
    targetKind: resolveEnumName<VesselTargetPayload>(
      get,
      "vessel.target",
      (p) => p.kind,
      TARGET_KIND_NAMES,
    ),
    commsControlStateName: resolveEnumName<VesselCommsPayload>(
      get,
      "vessel.comms",
      (p) => p.controlState,
      CONTROL_STATE_NAMES,
    ),
    commsControlStateOrdinal: resolveCommsControlStateOrdinal(get),
  };
}

/**
 * The `vessel.state` derivation (M2 design §2.4/§9.1). Reads `vessel.orbit`
 * + `vessel.flight` at the SAME frozen `viewUt` (the `get` closure enforces
 * this structurally — see `TimelineStore`) and quality-picks per
 * `Meta.Quality`, keyed off the ORBIT sample's quality specifically ("the
 * picker input is the quality on the orbit sample at viewUt" — M2 design
 * §2.4 — so a historical scrub through a regime change replays the switch
 * faithfully from archived quality stamps, not a live global flag):
 *
 * - **OnRails** (coasting): `vessel.orbit` is the CAUSE. Convert the wire's
 *   degrees→radians ONCE here (`meanAnomalyAtEpoch` is already radians — the
 *   documented KSP unit-convention quirk), substitute 0 for a `null`
 *   `lan`/`argPe` (the physically-degenerate near-equatorial/near-circular
 *   case — substituting 0 doesn't change the resulting state vector, it just
 *   picks an arbitrary node/apsis reference on a circle where none is
 *   physically distinguished), then `kepler.solve(elements, viewUt)` for
 *   position/velocity, plus `kepler.solveAnomalies(elements, viewUt)` for
 *   `period`/`trueAnomaly`/`timeToAp`/`timeToPe` (M3: derivable straight from
 *   the same elements, no extra input). `met` additionally reads
 *   `vessel.identity.launchUt`; `apoapsisAlt`/`periapsisAlt` additionally
 *   read `system.bodies` for the reference body's radius (`deriveApsides`).
 *   Both are now declared in `vesselStateChannel.inputs` (see that const's
 *   own doc comment for why growing that array is a real, deliberate,
 *   repo-wide change and not a free extra input to add lightly). `basis:
 *   "propagated"`.
 * - **Loaded** (powered/atmospheric): elements are osculating garbage for
 *   surface quantities, so altitude/vertical/surface speed come off
 *   `vessel.flight` at `viewUt` via `getInterpolated` — a straight-line lerp
 *   between the two buffered `vessel.flight` samples straddling `viewUt` (M2
 *   design §3.3/§2.4; `ClientTimeline.straddle` is the seam, `getInterpolated`
 *   is the "interpolating variant" this doc used to describe as deferred).
 *   Falls back to hold-last itself when there's nothing to straddle (e.g.
 *   only one `vessel.flight` sample so far). `basis: "measured"`.
 *
 * **`undefined` vs `null`, never conflated** (M2 design §2.1/§2.4 — this
 * task's explicit contract): no `vessel.orbit` point at-or-before `viewUt`
 * yet means the input isn't whole yet (cold start, or resynchronizing after
 * an epoch reset until the first post-reset keyframe lands) — there is no
 * quality signal to pick with, but nothing has confirmed the vessel is gone
 * either, so the whole record is `undefined` ("resynchronizing"). A
 * *tombstoned* `vessel.orbit` point (a real point whose `payload` is `null`)
 * means the vessel itself is confirmed absent, so the record is `null`.
 * Loaded quality with no `vessel.flight` point yet is `undefined` for the
 * same not-whole-yet reason; a tombstoned `vessel.flight` is `null`. Never a
 * fabricated zero-valued record either way.
 */
export function deriveVesselState(
  get: DerivedGet,
  viewUt: number,
  // Defaults to `get` (hold-last) so every pre-existing call site in this
  // file's own tests — written before `getInterpolated` existed — keeps its
  // exact prior behavior without passing a third argument.
  getInterpolated: DerivedGet = get,
): VesselState | null | undefined {
  const orbitPoint = get<VesselOrbitPayload>("vessel.orbit");
  if (!orbitPoint) return undefined; // not whole yet — no point at all
  if (orbitPoint.payload === null) return null; // tombstone — vessel confirmed absent

  const quality = orbitPoint.meta.quality;
  const subjectId = orbitPoint.meta.source;
  const orbit = orbitPoint.payload;

  if (quality === Quality.OnRails) {
    const elements: OrbitElements = {
      sma: orbit.sma,
      ecc: orbit.ecc,
      inc: degToRad(orbit.inc),
      lan: orbit.lan == null ? 0 : degToRad(orbit.lan),
      argPe: orbit.argPe == null ? 0 : degToRad(orbit.argPe),
      meanAnomalyAtEpoch: orbit.meanAnomalyAtEpoch,
      epoch: orbit.epoch,
      mu: orbit.mu,
    };
    const { position, velocity } = solve(elements, viewUt);
    const anomalies = solveAnomalies(elements, viewUt);

    const period = finiteOrNull((2 * Math.PI) / anomalies.meanMotion);
    const trueAnomaly = finiteOrNull(
      wrapDegrees360(radToDeg(anomalies.trueAnomaly)),
    );
    const timeToAp = timeToMeanAnomaly(
      anomalies.meanAnomaly,
      Math.PI,
      anomalies.meanMotion,
    );
    const timeToPe = timeToMeanAnomaly(
      anomalies.meanAnomaly,
      0,
      anomalies.meanMotion,
    );

    // A secondary input: its own absence nulls ONLY `met`, not the whole
    // record (contrast `vessel.orbit`/`vessel.flight` above, whose absence
    // is a whole-record `undefined`/`null`) — see `VesselState.met`'s doc.
    const identityPoint = get<VesselIdentityPayload>("vessel.identity");
    const launchUt =
      identityPoint && identityPoint.payload !== null
        ? identityPoint.payload.launchUt
        : null;
    const met = launchUt == null ? null : finiteOrNull(viewUt - launchUt);

    const { apoapsisAlt, periapsisAlt } = deriveApsides(get, orbit);

    const parentBodyIndex =
      identityPoint && identityPoint.payload !== null
        ? identityPoint.payload.parentBodyIndex
        : null;
    const parentBodyName = resolveBodyName(get, parentBodyIndex);
    const referenceBodyName = resolveBodyName(get, orbit.referenceBodyIndex);

    return {
      position,
      velocity,
      altitudeAsl: null,
      verticalSpeed: null,
      surfaceSpeed: null,
      orbitalSpeed: magnitude(velocity),
      met,
      period,
      trueAnomaly,
      apoapsisAlt,
      periapsisAlt,
      timeToAp,
      timeToPe,
      parentBodyName,
      referenceBodyName,
      ...deriveEncounter(get, orbit),
      targetRelativeSpeed: deriveTargetRelativeSpeed(get),
      ...deriveEnumDisplayMaps(get),
      basis: "propagated",
      subjectId,
    };
  }

  // Loaded — orbital elements are osculating garbage here (same reasoning
  // position/velocity aren't propagated in this basis), so all seven
  // orbital-derived fields stay null rather than deriving anything from them.
  const flightPoint = getInterpolated<VesselFlightPayload>("vessel.flight");
  if (!flightPoint) return undefined; // not whole yet — no point at all
  if (flightPoint.payload === null) return null; // tombstone — vessel confirmed absent
  const flight = flightPoint.payload;

  // Body-name resolution needs only the index + the body table (no orbital
  // propagation), so it's populated in the Loaded basis too — unlike the
  // orbital-derived fields above, which stay null here (osculating garbage).
  const identityPoint = get<VesselIdentityPayload>("vessel.identity");
  const parentBodyIndex =
    identityPoint && identityPoint.payload !== null
      ? identityPoint.payload.parentBodyIndex
      : null;

  return {
    position: null,
    velocity: null,
    altitudeAsl: flight.altitudeAsl,
    verticalSpeed: flight.verticalSpeed,
    surfaceSpeed: flight.surfaceSpeed,
    orbitalSpeed: flight.orbitalSpeed,
    met: null,
    period: null,
    trueAnomaly: null,
    apoapsisAlt: null,
    periapsisAlt: null,
    timeToAp: null,
    timeToPe: null,
    parentBodyName: resolveBodyName(get, parentBodyIndex),
    referenceBodyName: resolveBodyName(get, orbit.referenceBodyIndex),
    ...deriveEncounter(get, orbit),
    targetRelativeSpeed: deriveTargetRelativeSpeed(get),
    ...deriveEnumDisplayMaps(get),
    basis: "measured",
    subjectId,
  };
}

/**
 * `vessel.state`'s own `StreamStatusValue` (M2 design §4.4: "derived
 * channels propagate the worst input staleness into their own status", T4).
 * Mirrors `deriveVesselState`'s own branching EXACTLY — worst of
 * ACTUALLY-consulted inputs, not worst of every declared input: the OnRails
 * basis never reads `vessel.flight` at all (see the "does not read
 * vessel.flight at all" test above), so a `vessel.flight` that's
 * held-stale/resyncing must not drag down an OnRails `vessel.state` reading
 * that has nothing to do with it. `getStatus`/`get` are threaded in by
 * `TimelineStore.sampleDerivedStatus` — same shape as `deriveVesselState`'s
 * own `(get, viewUt)`, plus the status lookup.
 *
 * `undefined`/`null` on the orbit input map straight onto `"resyncing"`/
 * `"absent"` — the orbit sample's OWN status already encodes exactly that
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
  // despite a non-resyncing/absent status) — vessel.flight is consulted too.
  return worstStatus([orbitStatus, getStatus("vessel.flight")]);
}

/**
 * Ready-to-register definition — `store.registerDerivedChannel(vesselStateChannel)`.
 * `fields: true` exposes `vessel.state.<field>` subtopics (e.g.
 * `vessel.state.altitudeAsl`) reading off this one memoized record, per
 * `TimelineStore`'s field-subtopic mechanism.
 *
 * `inputs` grew to four with the M3 vessel-state-extend task
 * (`vessel.identity`/`system.bodies`, for `met`/`apoapsisAlt`/`periapsisAlt`
 * — see `deriveVesselState`'s doc). This array is NOT just documentation: the
 * M3 carried-channels gate (`carried-channels.ts`'s `isTopicCarried`, via
 * `TimelineStore.resolveSubscriptionTopics`) is PARENT-CHANNEL-scoped, not
 * per-field — a consumer of ANY `vessel.state.*` field (including the
 * already-shipped `altitudeAsl`/`orbitalSpeed`) is only "carried" once ALL
 * FOUR inputs are in its `carriedChannels` allowlist, not just the ones the
 * particular field it reads actually consults. Every existing
 * `carriedChannels` allowlist that lists `vessel.orbit`/`vessel.flight` for
 * a `vessel.state.*` read was updated alongside this change to also list
 * `vessel.identity`/`system.bodies` (harmless additions — a topic never
 * emitted on a given test's transport simply never arrives, same as any
 * other declared-but-quiet input). The alternative — leaving this array at
 * two and reading the new inputs via `get()` without declaring them — was
 * tried and rejected: it left `met`/`apoapsisAlt`/`periapsisAlt` "carried"
 * (since the gate only checks the declared two) but their extra inputs never
 * actually subscribed, so they'd read as a PERMANENT stuck `undefined`
 * instead of falling back to the still-working legacy `DataSource` read —
 * exactly the "big-bang blank-out" class of bug the carried-channels gate
 * exists to prevent (`carried-channels.ts`'s own doc comment).
 */
export const vesselStateChannel: DerivedChannelDefinition<VesselState> = {
  topic: "vessel.state",
  // Grew from four to SEVEN with the enum-ordinal→name migration (tasks 1–4:
  // `situationName`/`sasModeName`/`targetKind`/`commsControlState*`). The three
  // additions — `vessel.control`/`vessel.target`/`vessel.comms` — are the
  // source channels of the new display maps. Per this array's contract (above):
  // adding an input makes EVERY `vessel.state.*` field "carried" only once ALL
  // SEVEN inputs are, so every `carriedChannels` allowlist that reads any
  // `vessel.state.*` field was extended to list these three too (the runtime
  // default `DEFAULT_SITREP_CARRIED_TOPICS` already carries all three). The
  // display maps consult only their own single source channel, so an absent
  // one nulls just that ONE field (never the whole record) and never drags
  // `deriveVesselStateStatus` (still orbit/flight-only — those three are not
  // status-bearing kinematic inputs).
  inputs: [
    "vessel.orbit",
    "vessel.flight",
    "vessel.identity",
    "system.bodies",
    "vessel.control",
    "vessel.target",
    "vessel.comms",
  ],
  derive: deriveVesselState,
  deriveStatus: deriveVesselStateStatus,
  fields: true,
};
