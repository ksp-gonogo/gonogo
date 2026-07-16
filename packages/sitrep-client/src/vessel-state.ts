import { Quality } from "@ksp-gonogo/sitrep-sdk";
import type { Anomalies, OrbitElements, StateVector, Vector3 } from "./kepler";
import { solve, solveAnomalies } from "./kepler";
import {
  findImpactPoint,
  type LegacyOrbitPatch,
  mapOrbitPatch,
  type OrbitPatchWirePayload,
  ROTATION_PERIOD_SECONDS,
} from "./orbit-patches";
import { closestApproach, STANDARD_GRAVITY } from "./propagation";
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
 * The `vessel.orbit` channel payload — elements, never position (mirrors
 * `mod/Sitrep.Contract/VesselOrbit.cs`). Not yet codegen'd into
 * `@ksp-gonogo/sitrep-sdk`'s `__generated__/contract.ts` (that's the mod-side
 * channel-payload codegen, out of scope here) — hand-mirrored here so
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
  /**
   * The vessel's future-orbit patch chain (`mod/Sitrep.Contract/
   * OrbitPatch.cs`) — element 0 is the current orbit, followed by any
   * subsequent SOI-transition patches. Optional/defaults to `[]` for the
   * same "additive field older recordings may not carry" reason as
   * `encounter` above. Source of `vessel.state.orbitPatches` (old
   * Telemachus `o.orbitPatches`) and `deriveLanding`'s impact-point walk.
   */
  patches?: OrbitPatchWirePayload[];
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
 * C# class doc, NOT a sentinel.
 */
export interface VesselControlPayload {
  sasMode: number | null;
  /**
   * `[ag1..ag10]` in that fixed order (Action Groups Extended appends
   * further groups) — `mod/Sitrep.Contract/VesselControl.cs`'s
   * `ActionGroups: bool[]?`. `null`/absent when action-group data wasn't
   * available this tick (never a partial/short array). The source of the
   * derived `vessel.state.actionGroups` keyed map + per-index
   * `vessel.state.actionGroup{n}` booleans (old Telemachus `v.ag{n}Value`).
   */
  actionGroups?: boolean[] | null;
}

/**
 * The `vessel.propulsion` channel payload — hand-mirrored subset relevant to
 * the client-side TWR derivation (mirrors `mod/Sitrep.Contract/
 * VesselPropulsion.cs`). `totalMass`/`dryMass` in TONNES; `currentThrust`/
 * `availableThrust` in kN — dimensionally consistent for TWR
 * (`currentThrust / (totalMass · g)` = kN/(t·m/s²), dimensionless). The
 * contract's own doc comment already anticipates this as an SDK-side
 * derivation ("*Derived, SDK-side, NOT streamed here:* TWR").
 */
export interface VesselPropulsionPayload {
  totalMass: number;
  dryMass: number;
  currentThrust: number;
  availableThrust: number;
}

/**
 * The `vessel.target` channel payload — hand-mirrored subset relevant to the
 * `targetKind` display map (mirrors `mod/Sitrep.Contract/VesselTarget.cs`).
 * `kind` is the raw `Sitrep.Contract.TargetKind` enum ORDINAL on the wire
 * (`(int)target.Kind`). The WHOLE channel is absent (no point) when nothing is
 * targeted — the common case — never a sentinel record.
 *
 * `relativePosition`/`relativeVelocity` are the canonical `Vec3` fields
 * (metres / m/s, self-relative), each individually `null` when the transform
 * data needed to compute it wasn't available this tick. They're the
 * source of `vessel.state.targetRelativeSpeed` — the signed range-rate behind
 * the old Telemachus scalar `tar.o.relativeVelocity`.
 */
export interface VesselTargetPayload {
  kind: number;
  relativePosition?: Vec3 | null;
  relativeVelocity?: Vec3 | null;
  /**
   * The target's own orbit — the SAME `VesselOrbit` shape as the self vessel
   * (`mod/Sitrep.Contract/VesselTarget.cs`'s `Orbit` deliberately reuses
   * `VesselOrbit` so the SDK can propagate a target through the identical code
   * path). The source of `vessel.state.targetPeriapsisAlt`/`targetPeriod`/
   * `targetTrueAnomaly` (old Telemachus `tar.o.PeA`/`tar.o.period`/
   * `tar.o.trueAnomaly`). `null` when the target has no orbit (landed, or its
   * orbit couldn't be resolved this tick — the C# field's own null case);
   * optional here because older recordings / the reference fixture may not
   * carry it yet (treated identically to `null`).
   */
  orbit?: VesselOrbitPayload | null;
}

/**
 * The `vessel.comms` channel payload — hand-mirrored subset relevant to the
 * comms control-state display maps (mirrors `mod/Sitrep.Contract/
 * VesselComms.cs`). `controlState` is the raw `Sitrep.Contract.ControlState`
 * enum ORDINAL on the wire (`(int)comms.ControlState` in `VesselViewProvider`
 * — despite the old `map-topic.ts` gap comment calling it a "STRING enum", the
 * host serializes the integer, same as every other contract enum). The whole
 * channel is absent when `vessel.connection` is null.
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
 * The quality-picked, widget-facing kinematic surface — picks a single
 * authoritative kinematics path per sample rather than leaving that choice
 * to each widget, avoiding the dual-altitude ambiguity that creates.
 *
 * Scope note: an earlier cut derived ONLY from `vessel.orbit` +
 * `vessel.flight` (no `system.bodies`/`vessel.identity` inputs), so fields
 * needing body geometry or the launch clock were out of scope. Seven fields
 * below ARE derivable from already-served data —
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
   * Apoapsis RADIUS (distance from the reference body's CENTER, metres) —
   * `sma·(1+ecc)`, the old Telemachus `o.ApR` (`useOrbitElements`,
   * CurrentOrbit/OrbitView/ManeuverPlanner read it as a plain number). Derived
   * straight from the orbit elements, so — unlike `apoapsisAlt`, which
   * subtracts the body radius and is therefore `undefined` until
   * `system.bodies` carries it — this needs NO body table and is always a
   * finite number OnRails (`apoapsisAlt = apoapsisRadius - bodyRadius`
   * whenever the radius is known). OnRails basis only; `null` in the
   * "measured" basis or on a non-finite result.
   */
  apoapsisRadius: number | null;
  /** Periapsis RADIUS from the body center, metres: `sma·(1-ecc)` (old `o.PeR`). Same basis/finite-guard rules as `apoapsisRadius`. */
  periapsisRadius: number | null;
  /**
   * Current orbital RADIUS — distance from the reference body's center,
   * metres: `|position|` (the propagated parent-body-relative position vector,
   * the old Telemachus `o.radius` ManeuverPlanner feeds into its vis-viva
   * `computeMu`). OnRails basis only (needs the propagated position); `null`
   * in the "measured" basis (no position vector there) or on a non-finite
   * result.
   */
  orbitalRadius: number | null;
  /**
   * Which apsis comes NEXT — `1` = apoapsis, `-1` = periapsis (the old
   * Telemachus `o.nextApsisType` convention OrbitalEventChips/SystemView read;
   * `0`/N-A never emitted — `null` when neither apsis is reachable). Derived
   * by picking whichever of `timeToAp`/`timeToPe` is the smaller non-null
   * countdown. OnRails basis only (both countdowns are `null` in the
   * "measured" basis); `null` when neither countdown is available.
   */
  nextApsisType: number | null;
  /**
   * Seconds until the next apsis — the `timeToAp`/`timeToPe` matching
   * `nextApsisType` (old Telemachus `o.timeToNextApsis`). OnRails basis only;
   * `null` when neither countdown is available.
   */
  timeToNextApsis: number | null;
  /**
   * Horizontal (surface-tangent) speed, m/s — `sqrt(surfaceSpeed² -
   * verticalSpeed²)`, the surface-frame Pythagorean split of the measured
   * surface velocity (old Telemachus `v.horizontalVelocity`, OrbitalAscent's
   * ascent read). MEASURED basis only — sourced straight from `vessel.flight`,
   * exactly like `surfaceSpeed`/`verticalSpeed` themselves (both `null` in the
   * "propagated" basis, so this is too). Clamped at 0 before the sqrt so
   * floating-point `surfaceSpeed < verticalSpeed` noise never yields NaN.
   * `null` in the "propagated" basis or on a non-finite result.
   */
  horizontalSpeed: number | null;
  /**
   * Scalar range to the current target, metres — `|vessel.target.
   * relativePosition|` (old Telemachus `tar.distance`, DistanceToTarget/
   * TargetPicker). Populated in BOTH bases (self-relative kinematics).
   * `undefined` when `vessel.target` hasn't arrived or `relativePosition`
   * isn't available this tick; `null` on a confirmed tombstone. A genuine
   * zero range is a DEFINED `0`, not `undefined` (contrast
   * `targetRelativeSpeed`, which is `undefined` at zero range because it can't
   * form a line-of-sight unit vector — a distance needs no such vector).
   */
  targetDistance: number | null | undefined;
  /**
   * Target periapsis ALTITUDE above its reference body's mean radius, metres —
   * `sma·(1-ecc) - bodyRadius` off `vessel.target.orbit` (old Telemachus
   * `tar.o.PeA`, ManeuverPlanner). Populated in BOTH bases (the target's own
   * orbit is valid regardless of the self vessel's basis). `undefined` when
   * `vessel.target` hasn't arrived, the target has no orbit, or `system.bodies`
   * doesn't (yet) carry the target's reference-body radius; `null` on a
   * confirmed `vessel.target` tombstone. Same `undefined`-vs-`null` discipline
   * as `apoapsisAlt`.
   */
  targetPeriapsisAlt: number | null | undefined;
  /**
   * Target orbital period, seconds — `2π·sqrt(sma³/mu)` off
   * `vessel.target.orbit` (old Telemachus `tar.o.period`). Populated in BOTH
   * bases; needs no body table. `undefined` when `vessel.target` hasn't
   * arrived or the target has no orbit; `null` on a confirmed tombstone or a
   * non-finite result.
   */
  targetPeriod: number | null | undefined;
  /**
   * Target true anomaly at `viewUt`, DEGREES wrapped to [0, 360) — off
   * `vessel.target.orbit`, propagated to the SAME frozen `viewUt` as the self
   * vessel (old Telemachus `tar.o.trueAnomaly`, ManeuverPlanner). Populated in
   * BOTH bases. `undefined` when `vessel.target` hasn't arrived or the target
   * has no orbit; `null` on a confirmed tombstone or a non-finite result.
   */
  targetTrueAnomaly: number | null | undefined;
  /**
   * Situation NAME — the display-map resolution of `vessel.identity.situation`
   * (a numeric `Sitrep.Contract.Situation` enum ordinal on the wire) to its
   * enum name string ("Landed", "Orbiting", ...), the new home for the old
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
   * ...), the new home for the old Telemachus `comm.controlStateName` string
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
  /**
   * Thrust-to-weight ratio (dimensionless) — `currentThrust / (totalMass·g)`
   * off `vessel.propulsion` (old Telemachus `dv.currentTWR`, the Twr widget),
   * with `g` = standard gravity (9.80665 m/s²), the same constant KSP's own
   * TWR readout uses. Populated in BOTH bases (self-relative, no orbital
   * propagation). `undefined` while `vessel.propulsion` hasn't arrived or
   * `totalMass` is ≤ 0 (no meaningful weight to divide by); `null` on a
   * confirmed `vessel.propulsion` tombstone or a non-finite result.
   */
  twr: number | null | undefined;
  /**
   * Whether the vessel currently has command control — derived from
   * `vessel.comms.controlState` (old Telemachus `v.isControllable`, Navball):
   * `true` when the control state maps to a non-zero control LEVEL (any
   * Partial/Full/Probe/Kerbal control), `false` for the *None family
   * (`None`/`ProbeNone`/`KerbalNone`). Populated in BOTH bases. `undefined`
   * while `vessel.comms` hasn't arrived or the state is `Unknown` (no level);
   * `null` on a confirmed tombstone.
   */
  isControllable: boolean | null | undefined;
  /**
   * Whether the active vessel is a kerbal on EVA — `vessel.identity.vesselType
   * === EVA` (old Telemachus `v.isEVA`, CrewManifest). Populated in BOTH
   * bases. `undefined` while `vessel.identity` hasn't arrived; `null` on a
   * confirmed tombstone.
   */
  isEVA: boolean | null | undefined;
  /**
   * Whether the vessel is splashed down — `vessel.identity.situation ===
   * Splashed` (old Telemachus `v.splashed`, GroundSurvey). Populated in BOTH
   * bases. `undefined` while `vessel.identity` hasn't arrived; `null` on a
   * confirmed tombstone.
   */
  isSplashed: boolean | null | undefined;
  /**
   * Dynamic action-group state as a keyed map `{ "1": bool, ... }` (group id →
   * engaged) off `vessel.control.actionGroups` — supports Action Groups
   * Extended's variable count (old Telemachus `v.ag{n}Value` family). Keys are
   * 1-based group ids as strings. Populated in BOTH bases. `undefined` while
   * `vessel.control` hasn't arrived or the array is absent this tick; `null`
   * on a confirmed tombstone.
   */
  actionGroups: Record<string, boolean> | null | undefined;
  /** Action group 1 engaged — `vessel.control.actionGroups[0]` (old `v.ag1Value`). Same discipline as `actionGroups`. */
  actionGroup1: boolean | null | undefined;
  /** Action group 2 engaged (old `v.ag2Value`). */
  actionGroup2: boolean | null | undefined;
  /** Action group 3 engaged (old `v.ag3Value`). */
  actionGroup3: boolean | null | undefined;
  /** Action group 4 engaged (old `v.ag4Value`). */
  actionGroup4: boolean | null | undefined;
  /** Action group 5 engaged (old `v.ag5Value`). */
  actionGroup5: boolean | null | undefined;
  /** Action group 6 engaged (old `v.ag6Value`). */
  actionGroup6: boolean | null | undefined;
  /** Action group 7 engaged (old `v.ag7Value`). */
  actionGroup7: boolean | null | undefined;
  /** Action group 8 engaged (old `v.ag8Value`). */
  actionGroup8: boolean | null | undefined;
  /** Action group 9 engaged (old `v.ag9Value`). */
  actionGroup9: boolean | null | undefined;
  /** Action group 10 engaged (old `v.ag10Value`). */
  actionGroup10: boolean | null | undefined;
  /**
   * UT (seconds) of closest approach to the current target — the SDK-side
   * two-body closest-approach solve over `vessel.orbit` + `vessel.target.orbit`
   * (old Telemachus `o.closestTgtApprUT`, DistanceToTarget). Requires both
   * orbits to share a reference body (a cross-SOI approach isn't a single
   * two-body problem). OnRails basis only (needs the self orbit's elements as
   * a propagated conic). `undefined` while `vessel.target` hasn't arrived, the
   * target has no orbit, the two orbits are around different bodies, or in the
   * measured basis; `null` on a confirmed `vessel.target` tombstone or a
   * degenerate solve.
   */
  closestApproachUt: number | null | undefined;
  /**
   * Seconds until a no-burn ballistic vacuum fall reaches the terrain below —
   * the positive root of `altitudeTerrain = vDown·t + ½·g·t²` (old Telemachus
   * `land.timeToImpact`, LandingStatus). `g = mu/(radius+altitudeAsl)²` off
   * `vessel.orbit.mu` + the `system.bodies` radius; `vDown = -verticalSpeed`.
   * A vacuum approximation — ignores atmospheric drag, so on an atmospheric
   * body it's an upper bound. MEASURED basis only (reads `vessel.flight`);
   * `null` in the propagated basis, when not descending (`verticalSpeed ≥ 0`),
   * at or below the terrain (`altitudeTerrain ≤ 0`), or when a required input
   * (`system.bodies` radius, a finite `mu`) is missing.
   */
  landingTimeToImpact: number | null;
  /**
   * Speed at terrain impact with no burn, m/s — `√(surfaceSpeed² + 2·g·h)`,
   * the current surface speed with the potential energy of the remaining drop
   * added as kinetic energy (old Telemachus `land.speedAtImpact`,
   * LandingStatus). Uses the full `surfaceSpeed` magnitude, not just the
   * vertical component. Same vacuum approximation, inputs, basis and `null`
   * discipline as `landingTimeToImpact`.
   */
  landingSpeedAtImpact: number | null;
  /**
   * Residual speed at impact if a full-thrust retro burn starts NOW and runs
   * out of altitude before nulling velocity, m/s (old Telemachus
   * `land.bestSpeedAtImpact`, LandingStatus). `0` when the burn distance
   * `d = vDown²/(2·aNet)` fits within `altitudeTerrain` (a perfect landing is
   * reachable), else `√(vDown² − 2·aNet·h)`, with `aNet = availableThrust/
   * totalMass − g` the net deceleration. Uses the vertical descent component
   * `vDown` (vacuum-vertical model, matching `landingSuicideBurnCountdown`).
   * `null` when thrust can't overcome gravity (`aMax ≤ g`, TWR ≤ 1) plus the
   * same basis/input/`null` discipline as `landingTimeToImpact`.
   */
  landingBestSpeedAtImpact: number | null;
  /**
   * Seconds until the latest-possible full-thrust suicide burn must ignite to
   * null out velocity exactly at the terrain (old Telemachus
   * `land.suicideBurnCountdown`, LandingStatus). Solves the ballistic fall to
   * the ignition altitude `altitudeTerrain − d`, where `d = vDown²/(2·aNet)`
   * is the burn distance and `aNet = availableThrust/totalMass − g`. `0`
   * ("IGNITE") when already at or past that altitude; `null` when thrust can't
   * overcome gravity (`aMax ≤ g`, TWR ≤ 1). Uses the vertical descent
   * component `vDown` (vacuum-vertical model). Same basis/input/`null`
   * discipline as `landingTimeToImpact`.
   */
  landingSuicideBurnCountdown: number | null;
  /**
   * Predicted surface-impact latitude, degrees (old Telemachus
   * `land.predictedLat`, LandingStatus/GroundSurvey) — the last pre-surface
   * sample of a vacuum-ballistic walk over `orbitPatches` (`findImpactPoint`
   * in `orbit-patches.ts`), horizon-bounded by `landingTimeToImpact` so the
   * walk only ever runs while an impact is actually imminent. Same MEASURED
   * basis/`null` discipline as `landingTimeToImpact` — additionally `null`
   * when `landingTimeToImpact` itself is null, the body isn't in
   * `ROTATION_PERIOD_SECONDS` (non-stock body — an accepted, pre-existing
   * limitation MapView's own prediction already carries), or the walk never
   * finds an impact within its bounded horizon. Vacuum-exact; on an
   * atmospheric body this ignores drag — the WIDGET (which already knows
   * whether the body has an atmosphere via `getBody()`) is responsible for
   * an honest "approximate" treatment, not this field.
   */
  landingPredictedLat: number | null;
  /** Predicted surface-impact longitude, degrees (old Telemachus `land.predictedLon`). Same discipline as `landingPredictedLat` — always defined together. */
  landingPredictedLon: number | null;
  /**
   * The vessel's future-orbit patch chain, legacy-shaped (old Telemachus
   * `o.orbitPatches`, MapView's trajectory-overlay/maneuver-preview reads) —
   * a reshape of `vessel.orbit.patches` via `mapOrbitPatch`, populated in
   * BOTH bases (pure reshape, no propagation needed — the mod already
   * walked the chain). `undefined` before `vessel.orbit` arrives (mirrors
   * the whole record); an empty array is the common case (no upcoming SOI
   * transition on the current trajectory).
   */
  orbitPatches: LegacyOrbitPatch[];
  /** Which path produced this record's kinematics — never a widget's choice (this avoids the dual-altitude ambiguity bug). */
  basis: "propagated" | "measured";
  /** `vessel:<guid>` — subject provenance, from the orbit sample's envelope `meta.source`. */
  subjectId: string;
}

function magnitude(v: Vector3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/**
 * `kepler.solve`/`solveAnomalies` throw a `RangeError` for `ecc >= 1` —
 * elliptical-only, matching the C# side (see their own doc comments); that
 * throwing contract is intentional and NOT something this file changes. A
 * genuine hyperbolic OnRails trajectory (a fast escape/flyby while
 * time-warping) is real, though, and letting the throw escape into
 * derived-channel resolution would take out every `vessel.state` consumer at
 * once. Full hyperbolic anomaly support is out of scope here (see the class
 * doc) — this just names the boundary so call sites can check it explicitly.
 */
function isHyperbolic(ecc: number): boolean {
  return ecc >= 1;
}

/** Non-throwing `kepler.solve` — `null` on a hyperbolic orbit instead of a RangeError. See `isHyperbolic`. */
function trySolve(elements: OrbitElements, ut: number): StateVector | null {
  return isHyperbolic(elements.ecc) ? null : solve(elements, ut);
}

/** Non-throwing `kepler.solveAnomalies` — `null` on a hyperbolic orbit instead of a RangeError. See `isHyperbolic`. */
function trySolveAnomalies(
  elements: OrbitElements,
  ut: number,
): Anomalies | null {
  return isHyperbolic(elements.ecc) ? null : solveAnomalies(elements, ut);
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
    // Apoapsis doesn't exist on a hyperbolic orbit (ecc >= 1) — sma < 0 there
    // makes `sma·(1+ecc) - radius` a finite but MEANINGLESS number, which
    // `finiteOrNull` can't catch, so this is an explicit check, not a
    // by-product of the finite guard. Periapsis stays valid: sma < 0,
    // ecc > 1 makes `sma·(1-ecc)` a positive radius, same formula either way.
    apoapsisAlt: isHyperbolic(orbit.ecc)
      ? null
      : finiteOrNull(orbit.sma * (1 + orbit.ecc) - radius),
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
 * Never throws on a missing index / missing table — that's a deliberate
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
 * Build the internal-radian `OrbitElements` (`kepler.ts`) from a wire
 * `VesselOrbitPayload` — the ONE place the wire's degree/radian unit mix is
 * normalized (inc/lan/argPe degrees→radians; `meanAnomalyAtEpoch` already
 * radians, the documented KSP quirk) and a `null` `lan`/`argPe` (undefined
 * node/apsis on a near-equatorial/near-circular orbit) is substituted with 0
 * — a physically-arbitrary-but-harmless reference. Shared by the self-vessel
 * OnRails branch and the target-orbit derivation (`tar.o.*`), so both
 * propagate through the identical conversion.
 */
function buildElements(o: VesselOrbitPayload): OrbitElements {
  return {
    sma: o.sma,
    ecc: o.ecc,
    inc: degToRad(o.inc),
    lan: o.lan == null ? 0 : degToRad(o.lan),
    argPe: o.argPe == null ? 0 : degToRad(o.argPe),
    meanAnomalyAtEpoch: o.meanAnomalyAtEpoch,
    epoch: o.epoch,
    mu: o.mu,
  };
}

/**
 * Resolve a body INDEX to its mean radius (metres) via `system.bodies` — the
 * radius half of `deriveApsides`'s lookup, factored out for the target-orbit
 * periapsis-altitude derivation (`targetPeriapsisAlt`). Same
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
  if (bodiesPoint.payload === null) return null;
  const body = bodiesPoint.payload.bodies.find((b) => b.index === index);
  return body?.radius ?? undefined;
}

/**
 * Scalar range to the current target (`vessel.state.targetDistance`, old
 * `tar.distance`) = `|vessel.target.relativePosition|`. `undefined` when
 * `vessel.target` hasn't arrived or the vector isn't available this tick;
 * `null` on a confirmed tombstone. A genuine zero range is a DEFINED `0` (a
 * distance needs no unit vector — contrast `deriveTargetRelativeSpeed`, which
 * is `undefined` at zero range). Never throws.
 */
function deriveTargetDistance(get: DerivedGet): number | null | undefined {
  const point = get<VesselTargetPayload>("vessel.target");
  if (!point) return undefined;
  if (point.payload === null) return null;
  const p = point.payload.relativePosition;
  if (p == null) return undefined;
  const distance = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
  return Number.isFinite(distance) ? distance : undefined;
}

/**
 * The target's orbit-derived scalars (`vessel.state.targetPeriapsisAlt`/
 * `targetPeriod`/`targetTrueAnomaly`, old `tar.o.PeA`/`tar.o.period`/
 * `tar.o.trueAnomaly`) off `vessel.target.orbit` — the SAME `VesselOrbit`
 * shape as the self vessel, propagated to the same frozen `viewUt` through
 * `buildElements` + `kepler.solveAnomalies` (never a bespoke second solve).
 * The target's own orbit is valid regardless of the SELF vessel's basis, so
 * these are populated in both. `undefined` (all three) when `vessel.target`
 * hasn't arrived or the target has no orbit; `null` (all three) on a confirmed
 * tombstone. `targetPeriapsisAlt` additionally needs `system.bodies` for the
 * reference-body radius — `undefined` (only it) until that's whole, `null`
 * (only it) on a `system.bodies` tombstone — same `deriveApsides` discipline;
 * `targetPeriod`/`targetTrueAnomaly` need no body table. Never throws.
 */
function deriveTargetOrbit(
  get: DerivedGet,
  viewUt: number,
): {
  targetPeriapsisAlt: number | null | undefined;
  targetPeriod: number | null | undefined;
  targetTrueAnomaly: number | null | undefined;
} {
  const point = get<VesselTargetPayload>("vessel.target");
  if (!point) {
    return {
      targetPeriapsisAlt: undefined,
      targetPeriod: undefined,
      targetTrueAnomaly: undefined,
    };
  }
  if (point.payload === null) {
    return {
      targetPeriapsisAlt: null,
      targetPeriod: null,
      targetTrueAnomaly: null,
    };
  }
  const orbit = point.payload.orbit;
  if (orbit == null) {
    return {
      targetPeriapsisAlt: undefined,
      targetPeriod: undefined,
      targetTrueAnomaly: undefined,
    };
  }

  const elements = buildElements(orbit);
  // A hyperbolic target (ecc >= 1) is real (an escaping/flyby target vessel
  // or body) — trySolveAnomalies degrades to null instead of throwing;
  // targetPeriapsisAlt below stays valid regardless (see isHyperbolic doc).
  const anomalies = trySolveAnomalies(elements, viewUt);

  const targetPeriod =
    anomalies == null
      ? null
      : finiteOrNull((2 * Math.PI) / anomalies.meanMotion);
  const targetTrueAnomaly =
    anomalies == null
      ? null
      : finiteOrNull(wrapDegrees360(radToDeg(anomalies.trueAnomaly)));

  const radius = resolveBodyRadius(get, orbit.referenceBodyIndex);
  const targetPeriapsisAlt =
    radius == null
      ? radius
      : finiteOrNull(orbit.sma * (1 - orbit.ecc) - radius);

  return { targetPeriapsisAlt, targetPeriod, targetTrueAnomaly };
}

/**
 * Which apsis comes next (`vessel.state.nextApsisType`, old
 * `o.nextApsisType`: `1` = Ap, `-1` = Pe) and the seconds until it
 * (`timeToNextApsis`, old `o.timeToNextApsis`) — picked as whichever of the
 * already-derived `timeToAp`/`timeToPe` countdowns is the smaller non-`null`
 * value. `{ null, null }` when neither countdown is available (both `null` —
 * e.g. the "measured" basis, where the orbital countdowns aren't derived).
 * Never emits the legacy `0`/N-A sentinel — an unavailable next-apsis is
 * `null`, which the consuming chip treats identically (it renders only for a
 * `±1` type with a finite time).
 */
function deriveNextApsis(
  timeToAp: number | null,
  timeToPe: number | null,
): { nextApsisType: number | null; timeToNextApsis: number | null } {
  if (timeToAp != null && (timeToPe == null || timeToAp <= timeToPe)) {
    return { nextApsisType: 1, timeToNextApsis: timeToAp };
  }
  if (timeToPe != null) {
    return { nextApsisType: -1, timeToNextApsis: timeToPe };
  }
  return { nextApsisType: null, timeToNextApsis: null };
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
 * Collapse a raw `Sitrep.Contract.ControlState` enum ordinal
 * (`vessel.comms.controlState`) to CommSignal's Telemachus 0/1/2 control-LEVEL
 * scheme via {@link CONTROL_STATE_LEVEL}. `undefined` for an out-of-range /
 * `Unknown` ordinal (unrecognized). This is the single source of truth for the
 * collapse — both the derived `vessel.state.commsControlStateOrdinal` channel
 * (below) and de-Telemachus'd consumers that read `vessel.comms` canonically
 * (e.g. `SignalLossIndicator`) share it rather than re-tabulating the mapping.
 */
export function collapseControlStateLevel(
  controlState: number,
): number | undefined {
  return CONTROL_STATE_LEVEL[controlState] ?? undefined;
}

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
  return collapseControlStateLevel(point.payload.controlState);
}

/**
 * All five enum-ordinal display maps carried on `vessel.state` —
 * `v.situationString`/`f.sasMode`/`tar.type`/`comm.controlStateName`
 * + numeric `comm.controlState`. Bundled so both quality branches of
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
 * `v.isControllable`) — derived from `vessel.comms.controlState` via the same
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
  const level = CONTROL_STATE_LEVEL[point.payload.controlState];
  return level === undefined ? undefined : level > 0;
}

/**
 * The two `vessel.identity`-derived boolean flags (`vessel.state.isEVA`/
 * `isSplashed`, old `v.isEVA`/`v.splashed`) — EVA from the `vesselType`
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
 * The dynamic action-group derivation off
 * `vessel.control.actionGroups` (a fixed-order `[ag1..ag10]` bool array,
 * Action Groups Extended appends more): a keyed `{ [groupId]: bool }` map
 * (`vessel.state.actionGroups`, supports the variable count) PLUS the ten
 * fixed per-index `actionGroup{n}` booleans each existing ActionGroup widget
 * instance reads as its own bool (`vessel.state.actionGroup{n}`, old
 * `v.ag{n}Value`). All keys are ALWAYS present on the returned object (values
 * `undefined`/`null` when unavailable) so the phantom-field guard
 * (`vessel-state-mapping.coverage.test.ts`) sees every mapped field produced.
 * `undefined` (all) while `vessel.control` hasn't arrived or the array is
 * absent this tick; `null` (all) on a confirmed tombstone.
 */
function deriveActionGroups(get: DerivedGet): {
  actionGroups: Record<string, boolean> | null | undefined;
  actionGroup1: boolean | null | undefined;
  actionGroup2: boolean | null | undefined;
  actionGroup3: boolean | null | undefined;
  actionGroup4: boolean | null | undefined;
  actionGroup5: boolean | null | undefined;
  actionGroup6: boolean | null | undefined;
  actionGroup7: boolean | null | undefined;
  actionGroup8: boolean | null | undefined;
  actionGroup9: boolean | null | undefined;
  actionGroup10: boolean | null | undefined;
} {
  const fill = (
    v: boolean | null | undefined,
    map: Record<string, boolean> | null | undefined,
  ) => ({
    actionGroups: map,
    actionGroup1: v,
    actionGroup2: v,
    actionGroup3: v,
    actionGroup4: v,
    actionGroup5: v,
    actionGroup6: v,
    actionGroup7: v,
    actionGroup8: v,
    actionGroup9: v,
    actionGroup10: v,
  });

  const point = get<VesselControlPayload>("vessel.control");
  if (!point) return fill(undefined, undefined);
  if (point.payload === null) return fill(null, null);
  const arr = point.payload.actionGroups;
  if (arr == null) return fill(undefined, undefined);

  const map: Record<string, boolean> = {};
  for (let i = 0; i < arr.length; i++) map[String(i + 1)] = !!arr[i];
  const at = (n: number): boolean | undefined =>
    n <= arr.length ? !!arr[n - 1] : undefined;
  return {
    actionGroups: map,
    actionGroup1: at(1),
    actionGroup2: at(2),
    actionGroup3: at(3),
    actionGroup4: at(4),
    actionGroup5: at(5),
    actionGroup6: at(6),
    actionGroup7: at(7),
    actionGroup8: at(8),
    actionGroup9: at(9),
    actionGroup10: at(10),
  };
}

/**
 * Closest-approach UT to the current target (`vessel.state.closestApproachUt`,
 * old `o.closestTgtApprUT`) — the SDK-side two-body solve (`propagation.ts`'s
 * `closestApproach`) over the self orbit + `vessel.target.orbit`. `self` is
 * the already-built self-vessel elements (OnRails branch only — the measured
 * basis has no propagated conic to solve against). Requires both orbits to
 * share a reference body. `undefined` when `vessel.target` hasn't arrived, the
 * target has no orbit, the two orbits are around different bodies, or the
 * solve is degenerate; `null` on a confirmed `vessel.target` tombstone. Never
 * throws.
 */
function deriveClosestApproachUt(
  get: DerivedGet,
  self: VesselOrbitPayload,
  selfElements: OrbitElements,
  viewUt: number,
): number | null | undefined {
  const point = get<VesselTargetPayload>("vessel.target");
  if (!point) return undefined;
  if (point.payload === null) return null;
  const targetOrbit = point.payload.orbit;
  if (targetOrbit == null) return undefined;
  if (targetOrbit.referenceBodyIndex !== self.referenceBodyIndex)
    return undefined;
  const result = closestApproach(
    selfElements,
    buildElements(targetOrbit),
    viewUt,
  );
  return result === null ? undefined : (finiteOrNull(result.ut) ?? undefined);
}

/**
 * The `vessel.state` derivation. Reads `vessel.orbit`
 * + `vessel.flight` at the SAME frozen `viewUt` (the `get` closure enforces
 * this structurally — see `TimelineStore`) and quality-picks per
 * `Meta.Quality`, keyed off the ORBIT sample's quality specifically ("the
 * picker input is the quality on the orbit sample at viewUt" — so a
 * historical scrub through a regime change replays the switch
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
 *   `period`/`trueAnomaly`/`timeToAp`/`timeToPe` (derivable straight from
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
 *   between the two buffered `vessel.flight` samples straddling `viewUt`
 *   (`ClientTimeline.straddle` is the seam, `getInterpolated`
 *   is the "interpolating variant" this doc used to describe as deferred).
 *   Falls back to hold-last itself when there's nothing to straddle (e.g.
 *   only one `vessel.flight` sample so far). `basis: "measured"`.
 *
 * **`undefined` vs `null`, never conflated**: no `vessel.orbit` point
 * at-or-before `viewUt` yet means the input isn't whole yet (cold start, or
 * resynchronizing after an epoch reset until the first post-reset keyframe
 * lands) — there is no quality signal to pick with, but nothing has
 * confirmed the vessel is gone either, so the whole record is `undefined`
 * ("resynchronizing"). A *tombstoned* `vessel.orbit` point (a real point
 * whose `payload` is `null`) means the vessel itself is confirmed absent, so
 * the record is `null`. Loaded quality with no `vessel.flight` point yet is
 * `undefined` for the same not-whole-yet reason; a tombstoned
 * `vessel.flight` is `null`. Never a fabricated zero-valued record either
 * way.
 */
/** The six `null`-when-not-derivable landing scalars `deriveLanding` produces. */
interface LandingDerivations {
  landingTimeToImpact: number | null;
  landingSpeedAtImpact: number | null;
  landingBestSpeedAtImpact: number | null;
  landingSuicideBurnCountdown: number | null;
  landingPredictedLat: number | null;
  landingPredictedLon: number | null;
}

/** All six landing scalars `null` — the propagated basis and the not-derivable measured case. */
const LANDING_NONE: LandingDerivations = {
  landingTimeToImpact: null,
  landingSpeedAtImpact: null,
  landingBestSpeedAtImpact: null,
  landingSuicideBurnCountdown: null,
  landingPredictedLat: null,
  landingPredictedLon: null,
};

/**
 * Horizon multiplier + cap on `findImpactPoint`'s walk (see
 * `deriveLanding`'s doc comment) — 1.5× the closed-form `landingTimeToImpact`
 * estimate gives the patch-walk enough margin to actually cross the surface
 * (the closed-form model and the patch walk use different bases — vertical
 * vDown-only vs. full 3D propagation — so they don't reach zero altitude at
 * EXACTLY the same instant), capped at 20 minutes so a bad closed-form
 * estimate can never turn into an unbounded loop.
 */
const IMPACT_WALK_HORIZON_MULTIPLIER = 1.5;
const IMPACT_WALK_MAX_HORIZON_SEC = 1200;
/** ~60 samples across the bounded horizon — plenty of precision for a landing-site marker, cheap enough to run every `vessel.state` evaluation while descending. */
const IMPACT_WALK_MIN_STEPS = 60;

/**
 * The four client-derived ballistic landing scalars (`vessel.state.landing*`,
 * old Telemachus `land.timeToImpact`/`speedAtImpact`/`bestSpeedAtImpact`/
 * `suicideBurnCountdown`), MEASURED basis only. Every input is already on the
 * wire and carried — no terrain asset, no drag model, no mod-side channel:
 *
 * - `g = mu/(radius+altitudeAsl)²`, gravitational acceleration at the current
 *   radius. `mu` is the parent body's GM off `vessel.orbit.mu` (a physical
 *   body constant, valid even in the Loaded basis where the orbital ELEMENTS
 *   are osculating garbage); `radius` is the reference body's mean radius from
 *   `system.bodies` (same lookup as `deriveApsides`).
 * - `h = altitudeTerrain` (height above terrain), `vDown = -verticalSpeed`
 *   (positive downward), `vSurf = surfaceSpeed` — all off `vessel.flight`.
 * - `aMax = availableThrust/totalMass` (kN/t = m/s²) off `vessel.propulsion`.
 *
 * All four are `null` unless the vessel is descending toward terrain that's
 * still below it (`verticalSpeed < 0` and `h > 0`) and `g` resolves finite and
 * positive; the two burn-dependent fields are additionally `null` when thrust
 * can't overcome gravity (`aMax ≤ g`). The impact-energy field (`speedAtImpact`)
 * uses the full surface-speed magnitude; the two burn fields use the vertical
 * component `vDown` (a vacuum-vertical descent model). Vacuum throughout —
 * ignores atmospheric drag, so on an atmospheric body these are upper bounds
 * (the widget already labels that case "treat as upper bound").
 */
function deriveLanding(
  get: DerivedGet,
  orbit: VesselOrbitPayload,
  flight: VesselFlightPayload,
  orbitPatches: LegacyOrbitPatch[],
  viewUt: number,
): LandingDerivations {
  const h = flight.altitudeTerrain;
  const vDown = -flight.verticalSpeed;
  // Only meaningful while descending toward terrain still below the vessel.
  if (!(h > 0) || !(vDown > 0)) return LANDING_NONE;

  const radius = resolveBodyRadius(get, orbit.referenceBodyIndex);
  if (radius == null) return LANDING_NONE;
  const g =
    orbit.mu / ((radius + flight.altitudeAsl) * (radius + flight.altitudeAsl));
  if (!(g > 0) || !Number.isFinite(g)) return LANDING_NONE;

  // Ballistic no-burn fall to terrain: positive root of ½g·t² + vDown·t − h = 0.
  const timeToImpact = finiteOrNull(
    (-vDown + Math.sqrt(vDown * vDown + 2 * g * h)) / g,
  );
  // Impact speed with no burn — full surface speed plus the drop's added energy.
  const speedAtImpact = finiteOrNull(
    Math.sqrt(flight.surfaceSpeed * flight.surfaceSpeed + 2 * g * h),
  );

  const { landingPredictedLat, landingPredictedLon } = derivePredictedImpact(
    orbitPatches,
    radius,
    flight,
    viewUt,
    timeToImpact,
  );

  const aMax = deriveMaxAccel(get);
  // A suicide burn needs net deceleration — thrust must beat gravity (TWR > 1).
  if (aMax == null || !(aMax > g)) {
    return {
      landingTimeToImpact: timeToImpact,
      landingSpeedAtImpact: speedAtImpact,
      landingBestSpeedAtImpact: null,
      landingSuicideBurnCountdown: null,
      landingPredictedLat,
      landingPredictedLon,
    };
  }

  const aNet = aMax - g;
  // Distance to null out the vertical descent at full thrust.
  const burnDistance = (vDown * vDown) / (2 * aNet);
  // Best (minimum) impact speed if the burn starts now: 0 when the burn fits,
  // else the residual after decelerating across all remaining altitude.
  const bestSpeedAtImpact =
    burnDistance <= h
      ? 0
      : finiteOrNull(Math.sqrt(Math.max(0, vDown * vDown - 2 * aNet * h)));
  // Countdown to the latest ignition: ballistic fall to the ignition altitude
  // (h − burnDistance). 0 ("IGNITE") once already at or past it.
  const ignitionHeight = h - burnDistance;
  const suicideBurnCountdown =
    ignitionHeight <= 0
      ? 0
      : finiteOrNull(
          (-vDown + Math.sqrt(vDown * vDown + 2 * g * ignitionHeight)) / g,
        );

  return {
    landingTimeToImpact: timeToImpact,
    landingSpeedAtImpact: speedAtImpact,
    landingBestSpeedAtImpact: bestSpeedAtImpact,
    landingSuicideBurnCountdown: suicideBurnCountdown,
    landingPredictedLat,
    landingPredictedLon,
  };
}

/**
 * `landingPredictedLat`/`Lon`'s source — a horizon-bounded vacuum-ballistic
 * walk over `orbitPatches` (`findImpactPoint`, `orbit-patches.ts`). Bounding
 * the horizon off `deriveLanding`'s own closed-form `timeToImpact` estimate
 * (see `IMPACT_WALK_HORIZON_MULTIPLIER`'s doc comment) keeps this cheap: the
 * walk only ever runs while `deriveLanding`'s vertical-fall model already
 * says impact is imminent, never on every `vessel.state` evaluation for a
 * vessel that's merely in orbit. `null`/`null` when `timeToImpact` itself is
 * null, there are no orbit patches yet, or the current body isn't in
 * `ROTATION_PERIOD_SECONDS` (a non-stock body — the same limitation
 * MapView's own trajectory prediction already accepts via `getBody()`).
 */
function derivePredictedImpact(
  orbitPatches: LegacyOrbitPatch[],
  bodyRadius: number,
  flight: VesselFlightPayload,
  viewUt: number,
  timeToImpact: number | null,
): { landingPredictedLat: number | null; landingPredictedLon: number | null } {
  const none = { landingPredictedLat: null, landingPredictedLon: null };
  if (
    timeToImpact == null ||
    !(timeToImpact > 0) ||
    orbitPatches.length === 0
  ) {
    return none;
  }
  const bodyName = orbitPatches[0].referenceBody;
  const rotationPeriod = ROTATION_PERIOD_SECONDS[bodyName];
  if (rotationPeriod == null) return none;

  const horizonSec = Math.min(
    timeToImpact * IMPACT_WALK_HORIZON_MULTIPLIER,
    IMPACT_WALK_MAX_HORIZON_SEC,
  );
  const stepSec = Math.max(1, horizonSec / IMPACT_WALK_MIN_STEPS);
  const impact = findImpactPoint(
    orbitPatches,
    bodyName,
    bodyRadius,
    rotationPeriod,
    { ut: viewUt, lat: flight.latitude, lon: flight.longitude },
    horizonSec,
    stepSec,
  );
  if (!impact) return none;
  return {
    landingPredictedLat: impact.lat,
    landingPredictedLon: impact.lon,
  };
}

/**
 * Max achievable acceleration `availableThrust/totalMass` (kN/t = m/s²) off
 * `vessel.propulsion` — the ceiling a suicide burn can pull. `null` when
 * `vessel.propulsion` hasn't arrived, is a tombstone, or `totalMass ≤ 0`.
 */
function deriveMaxAccel(get: DerivedGet): number | null {
  const point = get<VesselPropulsionPayload>("vessel.propulsion");
  if (!point || point.payload === null) return null;
  const { availableThrust, totalMass } = point.payload;
  if (!(totalMass > 0)) return null;
  return finiteOrNull(availableThrust / totalMass);
}

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
  // Pure reshape of already-solved patches (mod-side, no propagation) — safe
  // to compute once, ahead of the quality branch, and reuse in both
  // (element 0 is the current orbit; see `orbit-patches.ts`).
  const orbitPatchesLegacy = (orbit.patches ?? []).map(mapOrbitPatch);

  if (quality === Quality.OnRails) {
    const elements: OrbitElements = buildElements(orbit);
    // A hyperbolic orbit (ecc >= 1, real on a fast escape/flyby while
    // time-warping) can't go through kepler's elliptical-only solver —
    // trySolve/trySolveAnomalies degrade to null instead of throwing, and
    // every field below that depends on them degrades to null in step
    // (never a bogus number). Full hyperbolic anomaly support is out of
    // scope; see `isHyperbolic`'s doc.
    const solved = trySolve(elements, viewUt);
    const anomalies = trySolveAnomalies(elements, viewUt);
    const position = solved?.position ?? null;
    const velocity = solved?.velocity ?? null;

    const period =
      anomalies == null
        ? null
        : finiteOrNull((2 * Math.PI) / anomalies.meanMotion);
    const trueAnomaly =
      anomalies == null
        ? null
        : finiteOrNull(wrapDegrees360(radToDeg(anomalies.trueAnomaly)));
    const timeToAp =
      anomalies == null
        ? null
        : timeToMeanAnomaly(
            anomalies.meanAnomaly,
            Math.PI,
            anomalies.meanMotion,
          );
    const timeToPe =
      anomalies == null
        ? null
        : timeToMeanAnomaly(anomalies.meanAnomaly, 0, anomalies.meanMotion);

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
      ...deriveEncounter(get, orbit),
      targetRelativeSpeed: deriveTargetRelativeSpeed(get),
      // Radii straight off the elements (no body table) — always finite here.
      // Apoapsis doesn't exist on a hyperbolic orbit (see isHyperbolic's
      // doc) — explicit check, not a by-product of finiteOrNull, since
      // sma·(1+ecc) is still a finite (just meaningless) number there.
      // Periapsis stays valid: sma·(1-ecc) is a positive radius either way.
      apoapsisRadius: isHyperbolic(orbit.ecc)
        ? null
        : finiteOrNull(orbit.sma * (1 + orbit.ecc)),
      periapsisRadius: finiteOrNull(orbit.sma * (1 - orbit.ecc)),
      orbitalRadius:
        position == null ? null : finiteOrNull(magnitude(position)),
      ...deriveNextApsis(timeToAp, timeToPe),
      // Surface-frame horizontal speed is a MEASURED quantity — null in the
      // propagated basis, exactly like surfaceSpeed/verticalSpeed above.
      horizontalSpeed: null,
      targetDistance: deriveTargetDistance(get),
      ...deriveTargetOrbit(get, viewUt),
      ...deriveEnumDisplayMaps(get),
      twr: deriveTwr(get),
      isControllable: deriveIsControllable(get),
      ...deriveIdentityFlags(get),
      ...deriveActionGroups(get),
      // Closest approach needs a propagated self conic — OnRails only.
      closestApproachUt: deriveClosestApproachUt(get, orbit, elements, viewUt),
      // Landing scalars are surface-frame MEASURED quantities (read
      // vessel.flight) — null in the propagated basis, like altitudeAsl/
      // verticalSpeed/surfaceSpeed/horizontalSpeed above.
      ...LANDING_NONE,
      orbitPatches: orbitPatchesLegacy,
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
    // Orbital-radius/next-apsis are OnRails-only (osculating garbage here),
    // same null posture as apoapsisAlt/timeToAp above.
    apoapsisRadius: null,
    periapsisRadius: null,
    orbitalRadius: null,
    nextApsisType: null,
    timeToNextApsis: null,
    // Horizontal speed is the measured-basis Pythagorean surface split — the
    // one new field that's LIVE here and null OnRails (the opposite split from
    // the orbital fields). Clamp before sqrt so FP noise never yields NaN.
    horizontalSpeed: finiteOrNull(
      Math.sqrt(
        Math.max(
          0,
          flight.surfaceSpeed * flight.surfaceSpeed -
            flight.verticalSpeed * flight.verticalSpeed,
        ),
      ),
    ),
    // The target's own kinematics/orbit are independent of the SELF basis, so
    // they're derived identically here.
    targetDistance: deriveTargetDistance(get),
    ...deriveTargetOrbit(get, viewUt),
    ...deriveEnumDisplayMaps(get),
    // Self-relative flags/derivations — independent of the kinematic basis.
    twr: deriveTwr(get),
    isControllable: deriveIsControllable(get),
    ...deriveIdentityFlags(get),
    ...deriveActionGroups(get),
    // Closest approach needs a propagated self conic (osculating garbage in
    // the measured basis) — OnRails only, null here.
    closestApproachUt: undefined,
    // Ballistic landing scalars — LIVE here (measured basis), off vessel.flight
    // + vessel.orbit.mu + the system.bodies radius + vessel.propulsion.
    ...deriveLanding(get, orbit, flight, orbitPatchesLegacy, viewUt),
    orbitPatches: orbitPatchesLegacy,
    basis: "measured",
    subjectId,
  };
}

/**
 * `vessel.state`'s own `StreamStatusValue` ("derived
 * channels propagate the worst input staleness into their own status").
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
 * `inputs` grew to four, adding
 * `vessel.identity`/`system.bodies`, for `met`/`apoapsisAlt`/`periapsisAlt`
 * — see `deriveVesselState`'s doc. This array is NOT just documentation: the
 * carried-channels gate (`carried-channels.ts`'s `isTopicCarried`, via
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
  // Grew from four to SEVEN with the enum-ordinal→name display maps:
  // `situationName`/`sasModeName`/`targetKind`/`commsControlState*`. The three
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
  // Grew to EIGHT to include `vessel.propulsion`, the source of the
  // client-derived `vessel.state.twr` (old
  // `dv.currentTWR`). Per this array's contract (above), adding it makes
  // EVERY `vessel.state.*` field "carried" only once `vessel.propulsion` is
  // too — so `DEFAULT_SITREP_CARRIED_TOPICS` and every test `carriedChannels`
  // allowlist that reads any `vessel.state.*` field was extended to list it.
  // The other flag/derivation additions (`isControllable`/`isEVA`/
  // `isSplashed`/`actionGroup*`/`closestApproachUt`) read only channels
  // ALREADY declared here (`vessel.comms`/`vessel.identity`/`vessel.control`/
  // `vessel.target`), so they added no new input.
  inputs: [
    "vessel.orbit",
    "vessel.flight",
    "vessel.identity",
    "system.bodies",
    "vessel.control",
    "vessel.target",
    "vessel.comms",
    "vessel.propulsion",
  ],
  derive: deriveVesselState,
  deriveStatus: deriveVesselStateStatus,
  fields: true,
};
