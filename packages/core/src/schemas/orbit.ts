/**
 * Stage and vessel-targeting shapes shared by the stream-derived data paths.
 */

/**
 * One entry of the `dv.stages` complex-object response. Note the JSON field
 * names differ from the legacy per-key names for the indexed accessors
 * (e.g. `dv.stageDVVac[n]` → `deltaVVac`): the labels below match the JSON
 * response, not the dv keys.
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
