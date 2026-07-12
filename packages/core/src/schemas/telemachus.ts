/**
 * Type-level schema for the Telemachus Reborn data source.
 *
 * All known telemetry keys and their value types, based on the Telemachus
 * Reborn API. Key naming follows the API exactly.
 *
 * Third-party data sources follow the same pattern by augmenting
 * `DataSourceRegistry` via declaration merging in their own package:
 *
 *   declare module '@ksp-gonogo/core' {
 *     interface DataSourceRegistry {
 *       'my-source': MySourceSchema;
 *     }
 *   }
 */

import type {
  AvailableVesselEntry,
  ManeuverNode,
  OrbitPatch,
  StageInfo,
} from "./orbit";
import type {
  SCANAnomalyEntry,
  SCANBiomeGrid,
  SCANCoverageBitmap,
  SCANHeightGrid,
  SCANScanningVessel,
  SCANType,
} from "./scansat";
import type { VesselTopology } from "./vessel-parts";

type IndexedKey<K extends string> = `${K}[${number}]`;

export interface TelemaachusSchema {
  // --- v.* — Vessel ---

  // Position & altitude
  "v.altitude": number;
  "v.heightFromTerrain": number;
  "v.heightFromSurface": number;
  "v.terrainHeight": number;
  "v.lat": number;
  "v.long": number;

  // Velocity
  "v.surfaceSpeed": number;
  "v.verticalSpeed": number;
  "v.obtSpeed": number; // orbital speed (direct)
  "v.orbitalVelocity": number;
  "v.surfaceVelocity": number;
  "v.speed": number;
  "v.srfSpeed": number;

  // Forces & environment
  "v.geeForce": number;
  "v.geeForceImmediate": number;
  "v.mass": number;
  "v.mach": number;
  "v.dynamicPressure": number;
  "v.dynamicPressurekPa": number;
  "v.staticPressure": number;
  "v.atmosphericPressure": number;
  // Ambient atmospheric conditions. `v.atmosphericTemperature` is the local
  // air temperature in kelvin; `v.externalTemperature` is the per-vessel
  // skin-temperature value KSP uses for re-entry heating. They diverge once
  // the craft is moving — `external` includes ram-air heating.
  "v.atmosphericDensity": number;
  "v.atmosphericTemperature": number;
  "v.externalTemperature": number;
  "v.indicatedAirSpeed": number;

  // Solar context. `v.solarFlux` is in W/m² (stock units), `v.directSunlight`
  // is true when the vessel has line-of-sight to the star.
  "v.solarFlux": number;
  "v.directSunlight": boolean;
  "v.distanceToSun": number;

  // Live biome string from `ScienceUtil.GetExperimentBiome`. Use this for
  // "where am I right now"; ScienceBench stored-experiment rows keep their
  // own per-record biome (the biome the experiment was *taken in*).
  "v.biome": string;

  // Situation & state
  "v.name": string;
  "v.body": string;
  "v.situation": string;
  "v.situationString": string;
  "v.missionTime": number;
  "v.missionTimeString": string;
  "v.currentStage": number;
  "v.landed": boolean;
  "v.splashed": boolean;
  "v.landedAt": string;
  "v.isEVA": boolean;
  "v.angleToPrograde": number;
  "v.crew": string[];
  "v.crewCount": number;
  "v.crewCapacity": number;

  // Topology (gonogo Telemachus fork additions)
  "v.topology": VesselTopology;
  "v.topologySeq": number;

  // Action group state (read)
  "v.sasValue": boolean;
  "v.rcsValue": boolean;
  "v.lightValue": boolean;
  "v.brakeValue": boolean;
  "v.gearValue": boolean;
  "v.abortValue": boolean;
  "v.precisionControlValue": boolean;
  "v.ag1Value": boolean;
  "v.ag2Value": boolean;
  "v.ag3Value": boolean;
  "v.ag4Value": boolean;
  "v.ag5Value": boolean;
  "v.ag6Value": boolean;
  "v.ag7Value": boolean;
  "v.ag8Value": boolean;
  "v.ag9Value": boolean;
  "v.ag10Value": boolean;

  // --- n.* — Navigation ---
  "n.heading": number;
  "n.pitch": number;
  "n.roll": number;
  "n.rawheading": number;
  "n.rawpitch": number;
  "n.rawroll": number;
  "n.heading2": number;
  "n.pitch2": number;
  "n.roll2": number;

  // --- f.* — Flight control (read values) ---
  "f.throttle": number;

  // --- o.* — Orbit ---

  // Apsides
  "o.ApA": number;
  "o.PeA": number;
  "o.ApR": number;
  "o.PeR": number;
  "o.timeToAp": number;
  "o.timeToPe": number;

  // --- b.* — Celestial bodies ---
  // `b.number` is the authoritative count — always 1 for stock Kerbol-only
  // installs, but can grow with mods that add bodies. Widgets that render
  // the whole system subscribe to b.number first, then to indexed keys
  // for each integer in [0, b.number).
  "b.number": number;
  [key: IndexedKey<"b.name">]: string;
  [key: IndexedKey<"b.referenceBody">]: string;
  [key: IndexedKey<"b.radius">]: number;
  [key: IndexedKey<"b.soi">]: number;
  [key: IndexedKey<"b.atmosphere">]: boolean;
  [key: IndexedKey<"b.atmosphereContainsOxygen">]: boolean;
  [key: IndexedKey<"b.maxAtmosphere">]: number;
  [key: IndexedKey<"b.hillSphere">]: number;
  [key: IndexedKey<"b.mass">]: number;
  [key: IndexedKey<"b.geeASL">]: number;
  // `b.rotationAngle` is the only b.* indexed key that ticks every WS frame
  // — it's used to drive the rotation marker on OrbitView. Subscribe per
  // body, not via the system-wide useCelestialBodies fan-out, to avoid
  // forcing every SystemView/TargetPicker re-render on every tick.
  [key: IndexedKey<"b.rotationPeriod">]: number;
  [key: IndexedKey<"b.rotationAngle">]: number;
  [key: IndexedKey<"b.rotates">]: boolean;
  [key: IndexedKey<"b.tidallyLocked">]: boolean;
  [key: IndexedKey<"b.description">]: string;
  [key: IndexedKey<"b.ocean">]: boolean;
  [key: IndexedKey<"b.o.sma">]: number;
  [key: IndexedKey<"b.o.eccentricity">]: number;
  [key: IndexedKey<"b.o.inclination">]: number;
  [key: IndexedKey<"b.o.period">]: number;
  [key: IndexedKey<"b.o.lan">]: number;
  [key: IndexedKey<"b.o.trueAnomaly">]: number;

  // Keplerian elements
  "o.sma": number;
  "o.semiMinorAxis": number;
  "o.semiLatusRectum": number;
  "o.eccentricity": number;
  "o.inclination": number;
  "o.lan": number;
  "o.argumentOfPeriapsis": number;
  "o.period": number;
  "o.epoch": number;
  "o.referenceBody": string;

  // Anomalies
  "o.trueAnomaly": number;
  "o.meanAnomaly": number;
  "o.eccentricAnomaly": number;
  "o.orbitPercent": number;

  // Velocity & energy
  "o.orbitalSpeed": number;
  "o.radius": number;
  "o.orbitalEnergy": number;

  // Patch transitions
  "o.timeToTransition1": number;
  "o.timeToTransition2": number;

  // SOI encounter / escape detection (off the active orbit's `patchEndTransition`).
  // `o.encounterExists`: -1 = escape (leaving current SOI), 0 = none, 1 = encounter
  //                     (entering another body's SOI). `o.encounterBody` is the
  //                     name of that body — for ENCOUNTER it's the next patch's
  //                     reference body, for ESCAPE it's the *grandparent* (e.g.
  //                     escaping Mun → "Kerbin"). Empty string when no transition.
  // `o.encounterTime`: seconds until the SOI transition. -1 sentinel when none.
  // `o.UTsoi`: absolute UT of the transition. Treat as undefined when
  //            `o.encounterExists === 0`.
  "o.encounterExists": number;
  "o.encounterBody": string;
  "o.encounterTime": number;
  "o.UTsoi": number;

  // Next-apsis chips. `o.nextApsisType`: -1 = Pe, 1 = Ap, 0 = N/A (hyperbolic
  // past Pe). `o.timeToNextApsis`: seconds; NaN for the hyperbolic past-Pe case.
  "o.nextApsisType": number;
  "o.timeToNextApsis": number;

  // Full patch list + maneuver nodes for the trajectory predictor. Subscribing
  // once gets all patches (including post-maneuver) — no per-UT queries needed.
  "o.orbitPatches": OrbitPatch[];
  "o.maneuverNodes": ManeuverNode[];

  // --- a.* — Application / physics ---
  // "patched_conics" (stock) | "n_body" (Principia). Can transiently report
  // "patched_conics" during scene loads on Principia installs — debounce
  // before acting on a transition.
  "a.physicsMode": string;

  // --- land.* — Landing prediction (WIP in Telemachus) ---
  // Gotcha: unpopulated fields return literal 0.0, not null/undefined.
  // Guard `predictedLat === 0 && predictedLon === 0` as "no prediction".
  // `timeToImpact` returns NaN when vessel isn't SUB_ORBITAL or FLYING.
  "land.timeToImpact": number;
  "land.speedAtImpact": number;
  "land.bestSpeedAtImpact": number;
  "land.suicideBurnCountdown": number;
  "land.predictedLat": number;
  "land.predictedLon": number;
  "land.predictedAlt": number;
  "land.slopeAngle": number;

  // --- t.* — Time ---
  "t.universalTime": number;
  "t.currentRate": number;
  "t.isPaused": boolean;

  // --- r.* — Resources ---
  // Resource amounts are indexed by resource name (LiquidFuel, Oxidizer,
  // MonoPropellant, XenonGas, ElectricCharge, …). Both vessel-wide totals
  // (`r.resource[NAME]`, `r.resourceMax[NAME]`) and current-stage figures
  // (`r.resourceCurrent[NAME]`, `r.resourceCurrentMax[NAME]`) are exposed.
  "r.resourceNameList": string;
  [key: `r.resource[${string}]`]: number;
  [key: `r.resourceMax[${string}]`]: number;
  [key: `r.resourceCurrent[${string}]`]: number;
  [key: `r.resourceCurrentMax[${string}]`]: number;

  // --- dv.* — Stage delta-V & mass ---
  // Prefer `dv.stages` (the whole-vessel complex object) over the indexed
  // accessors — one subscription, one broadcast per tick, length matches the
  // actual stage count rather than an arbitrary cap.
  "dv.stageCount": number;
  "dv.stages": StageInfo[];
  "dv.totalDVVac": number;
  "dv.totalDVASL": number;
  "dv.totalDVActual": number;
  "dv.totalBurnTime": number;
  [key: IndexedKey<"dv.stageFuelMass">]: number;

  // --- therm.* — Thermal monitoring (WIP upstream) ---
  // Aggregate "hottest of" readouts. Telemachus picks the single hottest
  // part / engine each tick; we don't get per-part coverage here.
  "therm.hottestPartTemp": number;
  "therm.hottestPartTempKelvin": number;
  "therm.hottestPartMaxTemp": number;
  "therm.hottestPartTempRatio": number;
  "therm.hottestPartName": string;
  "therm.hottestEngineTemp": number;
  "therm.hottestEngineMaxTemp": number;
  "therm.hottestEngineTempRatio": number;
  "therm.anyEnginesOverheating": boolean;
  "therm.heatShieldTemp": number;
  "therm.heatShieldTempCelsius": number;
  "therm.heatShieldFlux": number;

  // --- comm.* — CommNet signal state ---
  // Telemachus Reborn reads these straight from stock `Vessel.Connection`
  // (CommNet). RemoteTech is not supported. `signalDelay` is always 0 on
  // vanilla; becomes meaningful only with third-party signal-delay mods.
  "comm.connected": boolean;
  "comm.signalStrength": number;
  "comm.controlState": number;
  "comm.controlStateName": string;
  "comm.signalDelay": number;

  // --- tar.* — Target ---
  "tar.name": string;
  "tar.type": string;
  "tar.distance": number;

  /**
   * Vessels eligible for `tar.setTargetVessel`. The `index` field is the
   * argument to pass back to the action — `FlightGlobals.Vessels` indices.
   * Position is in the active vessel's local frame (Unity
   * `transform.InverseTransformPoint`); the client derives distance and
   * bearing from the vector. Server-side filtered to exclude Flag / EVA /
   * Debris / Unknown vessel types plus the active vessel itself.
   *
   * `situation` is the stringified `Vessel.Situations` enum: LANDED,
   * SPLASHED, PRELAUNCH, FLYING, SUB_ORBITAL, ORBITING, ESCAPING, DOCKED.
   */
  "tar.availableVessels": AvailableVesselEntry[];
  "tar.o.PeA": number;
  "tar.o.ApA": number;
  "tar.o.sma": number;
  "tar.o.inclination": number;
  "tar.o.eccentricity": number;
  "tar.o.period": number;
  "tar.o.relativeVelocity": number;
  "tar.o.orbitingBody": string;
  "tar.o.lan": number;
  "tar.o.argumentOfPeriapsis": number;
  "tar.o.trueAnomaly": number;
  "tar.o.timeToPe": number;
  "tar.o.timeToAp": number;

  // --- dock.* — Docking alignment (meaningful when the target is a vessel
  // or docking port; near-zero noise when the vessel isn't oriented for a
  // docking approach).
  "dock.ax": number;
  "dock.ay": number;
  "dock.az": number;
  "dock.x": number;
  "dock.y": number;

  // --- scan.* — SCANsat integration (gonogo Telemachus fork) ---
  // `scan.available` gates the whole section — false means SCANsat is not
  // installed. All other keys are only meaningful when this is true.
  "scan.available": boolean;

  /**
   * Full list of vessels SCANsat is currently tracking (loaded and unloaded).
   * Each entry carries per-sensor FoV / altitude range / in-range state and
   * the vessel's current sub-satellite ground point.
   */
  "scan.scanningVessels": SCANScanningVessel[];

  /**
   * Percentage of a body scanned for a given scan type.
   * `scan.coverage[bodyName, scanType]` — `scanType` is one of the
   * `SCAN_TYPE` integer bit values. Returns a number in [0, 100].
   */
  [key: `scan.coverage[${string},${number}]`]: number;

  /**
   * Bit-packed scan coverage bitmap for a body + scan type.
   * `scan.maskBitmap[bodyName, scanType]`
   */
  [key: `scan.maskBitmap[${string},${number}]`]: SCANCoverageBitmap;

  /**
   * Elevation grid for a body (PQS-backed, available without SCANsat).
   * `scan.heightGrid[bodyName]`
   */
  [key: `scan.heightGrid[${string}]`]: SCANHeightGrid;

  /**
   * Biome colour-index grid for a body (stock BiomeMap-backed).
   * `scan.biomeGrid[bodyName]`
   */
  [key: `scan.biomeGrid[${string}]`]: SCANBiomeGrid;

  /**
   * Known anomalies for a body (requires SCANsat Anomaly scan for discovery).
   * `scan.anomalies[bodyName]`
   */
  [key: `scan.anomalies[${string}]`]: SCANAnomalyEntry[];

  /**
   * Terrain elevation in metres at a specific lat/lon on a body.
   * `scan.elevation[bodyName, lat, lon]`
   */
  [key: `scan.elevation[${string},${number},${number}]`]: number;

  /**
   * Biome name at a specific lat/lon on a body (stock BiomeMap lookup).
   * `scan.biome[bodyName, lat, lon]`
   */
  [key: `scan.biome[${string},${number},${number}]`]: string;
}
