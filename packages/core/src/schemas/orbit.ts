/**
 * Orbit / trajectory / vessel-targeting shapes shared by the trajectory
 * calculator, the maneuver planner, and both the legacy Telemachus schema
 * and the current stream-derived data paths.
 */

/**
 * One entry of the `dv.stages` complex-object response. Note the JSON field
 * names differ from the per-key names Telemachus uses for the indexed
 * accessors (e.g. `dv.stageDVVac[n]` → `deltaVVac`) — the labels below match
 * the JSON response, not the dv keys.
 *
 * `stage` is the stage number as KSP counts them (current stage counts down
 * as stages separate).
 */
export interface StageInfo {
  stage: number;
  stageMass: number;
  dryMass: number;
  fuelMass: number;
  startMass: number;
  endMass: number;
  burnTime: number;
  deltaVVac: number;
  deltaVASL: number;
  deltaVActual: number;
  TWRVac: number;
  TWRASL: number;
  TWRActual: number;
  ispVac: number;
  ispASL: number;
  ispActual: number;
  thrustVac: number;
  thrustASL: number;
  thrustActual: number;
}

/**
 * A single patched-conic segment as returned by Telemachus's
 * `OrbitPatchJSONFormatter`. One of the array entries for `o.orbitPatches`
 * and for each `ManeuverNode.orbitPatches`.
 *
 * Caveat: the `eccentricAnomaly` field in the raw response is a known bug —
 * it's actually `eccentricity` again. Intentionally omitted from this type so
 * callers don't accidentally treat it as anomaly data; compute E from e + M
 * if you need it.
 */
export interface OrbitPatch {
  startUT: number;
  endUT: number;
  /** `"INITIAL" | "ESCAPE" | "ENCOUNTER" | "MANEUVER" | "FINAL"` (enum varies by KSP version). */
  patchStartTransition: string;
  patchEndTransition: string;
  PeA: number;
  ApA: number;
  inclination: number;
  eccentricity: number;
  epoch: number;
  period: number;
  argumentOfPeriapsis: number;
  sma: number;
  lan: number;
  /** Mean anomaly at epoch (radians). */
  maae: number;
  /** Name of the reference body for this patch (matches body registry IDs). */
  referenceBody: string;
  semiLatusRectum: number;
  semiMinorAxis: number;
  closestEncounterBody: string | null;
}

/**
 * One row from `tar.availableVessels`. The server-side filter is fixed
 * (Flag / EVA / Debris / Unknown + the active vessel are excluded); the
 * client doesn't get a knob.
 */
export interface AvailableVesselEntry {
  /** Exact argument for `tar.setTargetVessel[index]`. */
  index: number;
  name: string;
  /** Stringified `Vessel.vesselType` enum (Probe, Lander, Ship, Plane, ...). */
  type: string;
  /** Stringified `Vessel.Situations` enum. */
  situation: string;
  /** Name of the vessel's current mainBody, or empty string. */
  body: string;
  /** Active vessel's local-frame position `[x, y, z]` in metres. */
  position?: [number, number, number];
}

/**
 * A planned maneuver node. Telemachus includes the post-burn orbit patches
 * inline so a single subscription to `o.maneuverNodes` covers both the node
 * and its resulting trajectory.
 */
export interface ManeuverNode {
  UT: number;
  /** Raw Vector3d serialised as `[x, y, z]`. */
  deltaV: [number, number, number];
  PeA: number;
  ApA: number;
  inclination: number;
  eccentricity: number;
  epoch: number;
  period: number;
  argumentOfPeriapsis: number;
  sma: number;
  lan: number;
  maae: number;
  referenceBody: string;
  closestEncounterBody: string | null;
  orbitPatches: OrbitPatch[];
}
