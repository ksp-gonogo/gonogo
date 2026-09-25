import type { PayloadMeta } from "../__generated__/contract";
import type { Quantityish } from "../magnitude";
import type { Value } from "../value";
import type { PropagationHorizonLike } from "./kepler";
import type { OrbitPatchWirePayload } from "./orbit-patches";

/**
 * Hand-written mirrors of channel payloads the generated contract does not yet
 * type in the shape the client reads. Each one follows its C# source in
 * `mod/Sitrep.Contract/` or the view provider that writes it, and has to be
 * kept in step with that source by hand.
 */

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
 * One upcoming SOI patch transition: the `vessel.orbit.encounter` nullable
 * record (`mod/Sitrep.Contract/VesselOrbit.cs`'s `OrbitEncounter`). The whole
 * record is `null` when there's no upcoming SOI transition on the current
 * trajectory (the common case): never a sentinel.
 *
 * `transitionType` is the raw `Sitrep.Contract.TransitionType` enum ORDINAL on
 * the wire (Initial 0 / Final 1 / Encounter 2 / Escape 3 / Maneuver 4 /
 * Collision 5 / Unknown 6: VesselEnums.cs); `transitionUt` is the UT-seconds
 * of the transition; `bodyIndex` is the `system.bodies` index of the body
 * being transitioned INTO (`null` if it couldn't be resolved).
 */
export interface OrbitEncounterPayload {
  transitionType: number;
  transitionUt: Value<"s">;
  bodyIndex: number | null;
}

/**
 * The `vessel.orbit` channel payload: elements, never position (mirrors
 * `mod/Sitrep.Contract/VesselOrbit.cs`).
 *
 * Units, verbatim from the C# doc comment: `sma` in metres; `inc`/`lan`/
 * `argPe` in DEGREES (KSP-native); `meanAnomalyAtEpoch` in RADIANS (also
 * KSP-native): an inherited KSP inconsistency, deliberately kept. `lan`/
 * `argPe` are `null` for an undefined ascending node / periapsis (near-
 * equatorial / near-circular orbits): never NaN, never a fake 0.
 */
export interface VesselOrbitPayload {
  /**
   * The sample's own provenance, `"vessel:<guid>"` for a craft and `"game"`
   * for a reading no vessel owns (`Sitrep.Host.VesselViewProvider.BuildMeta`).
   *
   * NOT the same fact as the envelope `Meta.source` beside it, which is the
   * Courier NODE a topic records under and is the literal `"system"` for every
   * non-fleet topic. `Sitrep.Host.IntegrationTests.FoundationChannelsEndToEndTests`
   * asserts both on one delivered frame, and says so.
   *
   * Optional because a recording made before it was read here, and the golden
   * conformance fixtures, carry no payload meta; `subjectId` is then empty,
   * which every reader already treats as "unknown subject".
   */
  meta?: PayloadMeta;
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
  patches?: OrbitPatchWirePayload[];
  /**
   * How far these elements answer for, as the producer states it
   * (`PropagationHorizon`, required on the wire).
   *
   * Read it with `canPropagate` before extrapolating from these elements.
   * Optional on the same grounds as `encounter`, and `canPropagate` REFUSES on
   * an absent one rather than reading silence as permission.
   */
  horizon?: PropagationHorizonLike;
}

/**
 * The `vessel.flight` channel payload: measurements, not evaluations
 * (mirrors `mod/Sitrep.Contract/VesselFlight.cs`).
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
 * A subset of the `vessel.identity` channel payload (mirrors
 * `mod/Sitrep.Contract/VesselIdentity.cs`; the envelope `Meta` is not part of
 * this shape). `vesselType`/`situation` are the raw C# enum ordinals on the
 * wire (no TS enum exists yet for either: see `map-topic.ts`'s note on
 * `v.situationString`).
 *
 * `launchUt`: sampleUt - missionTime; `null` before the vessel's launch clock
 * has started (see the C# class doc).
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
 * One NAMED custom action group: mirrors
 * `mod/Sitrep.Contract/VesselControl.cs`'s `ActionGroupState`. Identity travels
 * WITH the entry (`index`), so never infer it from array position: position
 * cannot carry a name. Whichever backend the mod elected supplies both, stock
 * reports ten `AG{n}`; Action Groups Extended reports up to 250 player-named
 * groups.
 */
export interface ActionGroupStatePayload {
  /** 1-based group number: the same number `vessel.control.setActionGroup` takes. Not dense, not necessarily sorted, and NOT bounded at 10. */
  index: number;
  /** Display name. Stock: `"AG1".."AG10"`. AGX: the player's own names. */
  name: string;
  /**
   * Whether the group is engaged. `null`/absent means the backend knows the
   * group exists but could not read it, which is NOT the same as disengaged:
   * collapsing the two draws an OFF toggle for a state nobody has read, and
   * inverting it commands the wrong way. Stock never reports one (its indexer
   * always answers); a per-group backend like AGX can.
   */
  state?: boolean | null;
}

/**
 * A subset of the `vessel.control` channel payload (mirrors
 * `mod/Sitrep.Contract/VesselControl.cs`). `sasMode` is the raw
 * `Sitrep.Contract.SasMode` enum ORDINAL on the wire (`VesselViewProvider`
 * serializes `(int)control.SasMode`), individually nullable: `null` is a
 * normal "this input isn't available this tick" per the C# class doc, NOT a
 * sentinel.
 */
export interface VesselControlPayload {
  sasMode: number | null;
  /**
   * Every CUSTOM action group the elected backend knows, each NAMED and
   * carrying its own index: `mod/Sitrep.Contract/VesselControl.cs`'s
   * `ActionGroups: ActionGroupState[]?`. `null`/absent when action-group data
   * wasn't available this tick (never a partial list).
   */
  actionGroups?: ActionGroupStatePayload[] | null;
}

/**
 * A subset of the `vessel.propulsion` channel payload (mirrors
 * `mod/Sitrep.Contract/VesselPropulsion.cs`). `totalMass`/`dryMass` in TONNES;
 * `currentThrust`/`availableThrust` in kN: dimensionally consistent for TWR
 * (`currentThrust / (totalMass · g)` = kN/(t·m/s²), dimensionless). The
 * contract's own doc comment names TWR as an SDK-side derivation ("*Derived,
 * SDK-side, NOT streamed here:* TWR").
 */
export interface VesselPropulsionPayload {
  totalMass: number;
  dryMass: number;
  currentThrust: number;
  availableThrust: number;
}

/**
 * A subset of the `vessel.comms` channel payload (mirrors
 * `mod/Sitrep.Contract/VesselComms.cs`). `controlState` is the raw
 * `Sitrep.Contract.ControlState` enum ORDINAL on the wire
 * (`(int)comms.ControlState` in `VesselViewProvider`): the host serializes the
 * integer, same as every other contract enum, so nothing here should read it
 * as a name. The whole channel is absent when `vessel.connection` is null.
 */
export interface VesselCommsPayload {
  controlState: number;
}

/** One body's orbital elements within `system.bodies`: `null` only for the root star (mirrors `SystemViewProvider.BuildOrbit`). Units match `VesselOrbitPayload`'s (degrees for inc/lan/argPe, radians for meanAnomalyAtEpoch). */
export interface SystemBodyOrbitPayload {
  sma: number | null;
  ecc: number | null;
  inc: number | null;
  lan: number | null;
  argPe: number | null;
  meanAnomalyAtEpoch: number | null;
  epoch: number | null;
}

/** One entry in the `system.bodies` array (mirrors `SystemViewProvider.BuildBody`). `index`, not array position: is the stable id `vessel.orbit.referenceBodyIndex`/`vessel.identity.parentBodyIndex` point at. */
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
   * The body's atmosphere, present only when it HAS one (`BodyEntry.atmosphere`,
   * "the airless vs. no-data distinction"). Absence is therefore a fact about
   * the body and not a gap, which is what lets `entryInterfaceRadius` treat an
   * airless body's floor as its surface rather than declining to have a floor.
   */
  atmosphere?: { depth?: Quantityish | null } | null;
}

/** The `system.bodies` channel payload (mirrors `SystemViewProvider.BuildSystemBodies`'s `{ "bodies": [...] }` shape). */
export interface SystemBodiesPayload {
  bodies: SystemBodyPayload[];
}
