import type { OrbitPatch, OrbitPayloadMeta } from "../__generated__/contract";
import type { Quantityish } from "../magnitude";
import type { Value } from "../value";
import type { PropagationHorizonLike } from "./kepler";

/**
 * Hand-written mirrors of channel payloads the generated contract does not yet
 * type in the shape the client reads. Each one follows its C# source in
 * `mod/Sitrep.Contract/` or the view provider that writes it, and has to be
 * kept in step with that source by hand.
 */

/**
 * A three-component vector as the wire carries it, `{ x, y, z }`, used by every
 * vector field of the `vessel.target` and `vessel.dock` Topics. Useful for
 * typing a position or direction read from those Topics.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * The next time a vessel's trajectory changes sphere of influence (SOI): the
 * `vessel.orbit.encounter` record. Useful for showing the operator an upcoming
 * encounter, escape or collision. The whole record is `null` when there is no
 * upcoming transition on the current trajectory, which is the common case.
 *
 * `transitionType` is the raw ordinal of the transition kind (Initial 0, Final
 * 1, Encounter 2, Escape 3, Maneuver 4, Collision 5, Unknown 6). `transitionUt`
 * is the instant of the transition. `bodyIndex` is the `system.bodies` index
 * of the body being entered, `null` when it could not be resolved.
 */
export interface OrbitEncounterPayload {
  transitionType: number;
  transitionUt: Value<"s">;
  bodyIndex: number | null;
}

/**
 * The payload of the `vessel.orbit` Topic: the orbital elements of a vessel,
 * with no position. Useful for showing the operator the shape of the orbit and
 * for working out where the vessel will be later.
 *
 * `sma` is in metres, `inc`, `lan` and `argPe` in degrees, and
 * `meanAnomalyAtEpoch` in radians. The mix of degrees and radians is KSP's
 * own and is kept. `lan` and `argPe` are `null` for an undefined ascending
 * node or periapsis (a near-equatorial or near-circular orbit), never NaN
 * and never 0.
 */
export interface VesselOrbitPayload {
  /**
   * The sample's own provenance: `"vessel:<guid>"` for a vessel and `"game"`
   * for a reading no vessel owns.
   *
   * This differs from the envelope `Meta.source` beside it, which is the
   * literal `"system"` for every non-fleet Topic.
   *
   * Optional because older recordings carry no payload meta. `subjectId` is
   * then empty, which readers treat as an unknown subject.
   */
  meta?: OrbitPayloadMeta;
  referenceBodyIndex: number;
  sma: Value<"m">;
  ecc: Value<"1">;
  inc: Value<"°">;
  lan: Value<"°"> | null;
  argPe: Value<"°"> | null;
  meanAnomalyAtEpoch: Value<"rad">;
  epoch: Value<"s">;
  mu: Value<"m³/s²">;
  /**
   * The next upcoming SOI transition, or `null` when there is none (the
   * common case). Optional because the reference wire fixture and older
   * recordings may not carry it: an absent one reads identically to `null`
   * (no encounter).
   */
  encounter?: OrbitEncounterPayload | null;
  /**
   * The vessel's future-orbit patch chain (`mod/Sitrep.Contract/
   * OrbitPatch.cs`): element 0 is the current orbit, followed by any
   * subsequent SOI-transition patches. Optional, and read as `[]` when
   * absent, for the same reason as `encounter`.
   */
  patches?: OrbitPatch[];
  /**
   * How far these elements answer for, as the producer states it
   * (`PropagationHorizon`, required on the wire).
   *
   * Read it with `canPropagate` before extrapolating from these elements.
   * Optional on the same grounds as `encounter`, and `canPropagate` refuses on
   * an absent one rather than reading silence as permission.
   */
  horizon?: PropagationHorizonLike;
}

/**
 * The payload of the `vessel.flight` Topic: what the vessel's instruments
 * measure right now, such as altitude, speeds, g-force and Mach number. Useful
 * for showing the operator a flight readout.
 */
export interface VesselFlightPayload {
  latitude: Value<"°">;
  longitude: Value<"°">;
  altitudeAsl: Value<"m">;
  altitudeTerrain: Value<"m">;
  verticalSpeed: Value<"m/s">;
  surfaceSpeed: Value<"m/s">;
  orbitalSpeed: Value<"m/s">;
  gForce: Value<"g">;
  dynamicPressureKPa: Value<"kPa">;
  mach: Value<"1">;
  atmDensity: Value<"kg/m³">;
}

/**
 * The fields of the `vessel.identity` Topic payload that clients read: which
 * vessel this is and what it is doing. Useful for labelling a vessel for the
 * operator. The envelope `Meta` is not part of this shape.
 *
 * `vesselType` and `situation` are raw ordinals as the wire carries them.
 * `launchUt` is the instant of launch, `null` before the vessel's launch clock
 * has started.
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
 * One named custom action group of a vessel. Useful for showing the operator a
 * toggle for each action group with its own name. Used by the action group
 * helpers that name and order the groups on a control panel.
 *
 * The group's identity is its `index`, so never infer it from array position.
 * Stock reports ten groups named `AG{n}`, and Action Groups Extended reports up
 * to 250 groups with the player's own names.
 */
export interface ActionGroupStatePayload {
  /** 1-based group number: the same number `vessel.control.setActionGroup` takes. Not dense, not necessarily sorted, and not bounded at 10. */
  index: number;
  /** Display name. Stock: `"AG1".."AG10"`. AGX: the player's own names. */
  name: string;
  /**
   * Whether the group is engaged. `null`/absent means the backend knows the
   * group exists but could not read it, which is not the same as disengaged:
   * collapsing the two draws an off toggle for a state nobody has read, and
   * inverting it commands the wrong way. Stock never reports one (its indexer
   * always answers); a per-group backend like AGX can.
   */
  state?: boolean | null;
}

/**
 * The fields of the `vessel.control` Topic payload that clients read: the
 * attitude hold mode and the action groups. Useful for showing the operator how
 * the vessel is being controlled.
 *
 * `sasMode` is the raw ordinal of the stability assist mode. A field is `null`
 * when that input is not available at the moment.
 */
export interface VesselControlPayload {
  sasMode: number | null;
  /**
   * Every custom action group the mod knows, each named and carrying its own
   * index. `null` or absent when action group data was not available at the
   * moment, never a partial list.
   */
  actionGroups?: ActionGroupStatePayload[] | null;
}

/**
 * The fields of the `vessel.propulsion` Topic payload that clients read: the
 * vessel's mass and thrust. Useful for showing the operator how much the vessel
 * weighs and how hard its engines can push.
 *
 * `totalMass` and `dryMass` are in tonnes, `currentThrust` and `availableThrust`
 * in kN. The thrust to weight ratio is not streamed: it is derived from these
 * as `currentThrust / (totalMass * g)`.
 */
export interface VesselPropulsionPayload {
  totalMass: number;
  dryMass: number;
  currentThrust: number;
  availableThrust: number;
}

/**
 * The fields of the `vessel.comms` Topic payload that clients read: whether the
 * command centre can control the vessel. Useful for showing the operator the
 * vessel's control state.
 *
 * `controlState` is the raw ordinal of the control state, never a name. The
 * whole Topic is absent when the vessel has no connection.
 */
export interface VesselCommsPayload {
  controlState: number;
}

/**
 * The orbital elements of one body within `system.bodies`, `null` for the root
 * star only. Useful for drawing a body's orbit. Units match
 * the vessel orbit payload: degrees for `inc`, `lan` and `argPe`, radians for
 * `meanAnomalyAtEpoch`.
 */
export interface SystemBodyOrbitPayload {
  sma: number | null;
  ecc: number | null;
  inc: number | null;
  lan: number | null;
  argPe: number | null;
  meanAnomalyAtEpoch: number | null;
  epoch: number | null;
}

/**
 * One body in the `system.bodies` array: its name, size, orbit and atmosphere.
 * Useful for showing the operator what a body is like. Used by the orbital
 * solver, which reads bodies from `system.bodies`.
 *
 * `index` is the stable id that `vessel.orbit.referenceBodyIndex` and
 * `vessel.identity.parentBodyIndex` point at, and array position is not.
 */
export interface SystemBodyPayload {
  name: string | null;
  index: number;
  parentIndex: number | null;
  /** Mean radius, metres. `null` when the live game hasn't reported it yet. */
  radius: number | null;
  /**
   * Sidereal rotation period, seconds. Optional because a stream that predates
   * the field simply omits it, and the impact walk has a fallback for that.
   */
  rotationPeriod?: number | null;
  orbit: SystemBodyOrbitPayload | null;
  /**
   * The body's atmosphere, present only when it has one. Absence means the body
   * is airless, and a consumer treats its surface as the floor.
   */
  atmosphere?: { depth?: Quantityish | null } | null;
}

/**
 * The payload of the `system.bodies` Topic: every body of the system. Useful
 * for listing and placing the bodies for the operator. Used by the system state
 * derivation that counts and indexes the bodies.
 */
export interface SystemBodiesPayload {
  bodies: SystemBodyPayload[];
}
