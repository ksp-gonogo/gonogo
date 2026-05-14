/**
 * Type-level schema for the Telemachus Reborn data source.
 *
 * All known telemetry keys and their value types, based on the Telemachus
 * Reborn API. Key naming follows the API exactly.
 *
 * Third-party data sources follow the same pattern by augmenting
 * `DataSourceRegistry` via declaration merging in their own package:
 *
 *   declare module '@gonogo/core' {
 *     interface DataSourceRegistry {
 *       'my-source': MySourceSchema;
 *     }
 *   }
 */

type IndexedKey<K extends string> = `${K}[${number}]`;

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
 * One part in the `v.topology` payload. Shape mirrors the Telemachus
 * `PartsTopologyDataLinkHandler` walker exactly — no client-side renaming.
 * Live per-tick values (resources, temperatures) are NOT here; they live on
 * the separate `r.resourceFor[flightId]` / `therm.part[flightId]` keys so
 * the topology snapshot stays cacheable across staging-quiet stretches.
 */
export interface TopologyPart {
  flightId: number;
  persistentId: number;
  parentFlightId: number | null;
  name: string;
  title: string;
  manufacturer: string;
  /** `PartCategories` enum as string (e.g. "Engine", "FuelTank"). */
  category: string;
  inverseStage: number;
  crewCapacity: number;
  maxTemp: number;
  crashTolerance: number;
  /** `Part.mass` — dry mass only, not including resources. */
  dryMass: number;
  /** Vessel-local root-relative position `[x, y, z]`. */
  orgPos: [number, number, number];
  /** Prefab renderer bounds in metres — stable across the session. */
  bounds: { size: { x: number; y: number; z: number } };
  /** Raw `PartModule.moduleName` strings; no filtering. */
  modules: string[];
}

/**
 * `v.topology` response shape. `topologySeq` matches the lightweight
 * `v.topologySeq` key — consumers subscribe to the seq and refetch this key
 * only when it ticks rather than streaming the topology continuously.
 */
export interface VesselTopology {
  topologySeq: number;
  rootFlightId: number;
  parts: TopologyPart[];
}

/**
 * Live per-part resource state from `r.resourceFor[flightId]`. Keyed by
 * resource name (LiquidFuel, Oxidizer, ElectricCharge, …); empty object
 * when the part has no resources or the flightId isn't found.
 */
export interface PartResources {
  [resourceName: string]: { amount: number; maxAmount: number };
}

/**
 * Live per-part thermal state from `therm.part[flightId]`. `null` upstream
 * when the flightId isn't found — consumers should treat the missing case
 * as "thermal data not available" rather than zero-Kelvin.
 */
export interface PartThermal {
  temperature: number;
  maxTemperature: number;
  temperatureK: number;
  maxTemperatureK: number;
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
  [key: IndexedKey<"b.maxAtmosphere">]: number;
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
}
