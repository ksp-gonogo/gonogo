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
  /**
   * For parts carrying `CModuleFuelLine`, the flightId of the receiving
   * tank — the "to" end of the line. `parentFlightId` already points
   * at the source. `null` for any non-fuel-line part. Optional because
   * fixtures captured before the fork started emitting it stay readable.
   */
  fuelLineTarget?: number | null;
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
  /**
   * Part's local +up axis in vessel-local frame (`part.orgRot * Vector3.up`).
   * `[0, 1, 0]` for axially-mounted parts (the majority); `[±1, 0, 0]` or
   * `[0, 0, ±1]` for radially-mounted parts (docking ports, side nose cones,
   * radial decouplers); inverted parts (rare) carry a negative-Y component.
   * Optional because fixtures captured before the fork started emitting it
   * stay readable — consumers should default to `[0, 1, 0]`.
   */
  up?: [number, number, number];
  /**
   * Prefab renderer bounds in metres — stable across the session.
   *
   * `size` is the mesh extent in part-local frame.
   *
   * `center` is the mesh-center offset from `orgPos` in *vessel-local*
   * frame (the fork pre-rotates by `orgRot` before emitting). Non-zero
   * for parts whose mesh doesn't sit on the attach-node anchor — radial
   * decouplers, surface ladders, structural brackets. Add it to `orgPos`
   * to get the mesh centre in assembly space. Optional because fixtures
   * captured before the fork started emitting it stay readable; missing
   * → treat as `{x: 0, y: 0, z: 0}` (correct for the axially-stacked
   * majority where the mesh centres on the anchor).
   */
  bounds: {
    size: { x: number; y: number; z: number };
    center?: { x: number; y: number; z: number };
  };
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
 * when the part has no resources / contributes no flow / the flightId
 * isn't found.
 *
 * `amount` / `maxAmount` cover storage. `flow` and `nominalFlow` are
 * present when the part's modules contribute production / consumption
 * (solar panels, RTGs, generators, ISRU, drills, engines):
 *
 * - `flow`: signed units/sec — positive = producing, negative =
 *   consuming. Summed across every contributing module on the part.
 * - `nominalFlow`: same sign, 100%-efficiency cap (sun-aligned solar,
 *   full-rate generator). Omitted when no module supports a nominal
 *   (e.g. engines), when no module contributes, or when nominal equals
 *   flow.
 *
 * Rows are emitted for resources the part contributes flow to even when
 * storage is zero — an RTG part reports `{ ElectricCharge: { amount: 0,
 * maxAmount: 0, flow: 0.7, nominalFlow: 0.75 } }`.
 */
export interface PartResources {
  [resourceName: string]: {
    amount: number;
    maxAmount: number;
    flow?: number;
    nominalFlow?: number;
  };
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
 * Behavioural state for one PartModule on a part — the fork emits one
 * entry per supported module under `v.partState[flightId].modules`.
 *
 * `type` discriminates the module; `state` is the standardised deploy /
 * activation vocabulary (see fork's PartStateDataLinkHandler):
 *
 * - `extended` / `retracted` / `deploying` / `retracting` — for parts
 *   that animate (solar panels, radiators, antennas, cargo bays, gear).
 * - `stowed` / `armed` / `extended` / `broken` — parachute lifecycle.
 *   `armed` means the chute is armed and waiting for atmospheric trigger.
 * - `active` / `inactive` — engines (EngineIgnited toggle), drills.
 * - `unknown` — fallback when the underlying KSP enum doesn't map.
 *
 * Module-specific extras:
 * - solarPanel: `tracking` (bool) — sun-tracking gimbal active.
 * - engine: `flameout` (bool, only when true) — fuel-starved.
 */
export interface PartStateModule {
  type:
    | "solarPanel"
    | "radiator"
    | "antenna"
    | "parachute"
    | "engine"
    | "drill"
    | "cargoBay"
    | "landingGear";
  state: string;
  tracking?: boolean;
  flameout?: boolean;
}

/**
 * `v.partState[flightId]` response. `seq` is a per-vessel counter the
 * fork bumps on staging, vessel modifications, part death / undock /
 * couple, PAW dismiss, and as a 10s backstop for events without a
 * GameEvent hook. Consumers dedup on `seq` rather than deep-comparing
 * the modules array. Returns `null` when the flightId is unknown.
 */
export interface PartState {
  seq: number;
  modules: PartStateModule[];
}

/**
 * SCANsat scan-type bit values. The fork's `scan.*` keys take an integer
 * matching one of these — bit positions are the same as SCANsat's own
 * `SCANtype` enum so the wire shape mirrors the source mod.
 */
export const SCAN_TYPE = {
  AltimetryLoRes: 1,
  AltimetryHiRes: 2,
  Biome: 8,
  Anomaly: 16,
  AnomalyDetail: 32,
  ResourceLoRes: 128,
  ResourceHiRes: 256,
} as const;
export type SCANType = (typeof SCAN_TYPE)[keyof typeof SCAN_TYPE];

/**
 * `scan.maskBitmap[bodyName, scanType]` response. `bits` is a base64-encoded
 * `(width * height + 7) / 8` byte buffer; each bit (MSB-first within each
 * byte, row-major over coverage) is set when the corresponding 1°×1° tile
 * has been scanned for the requested scan type. The natural granularity is
 * 360×180 (matching SCANsat's own `Coverage` array); clients upsample to
 * their own fog-mask resolution.
 *
 * Coverage indexing follows SCANsat's `icLON`/`icLAT`: bit index
 * `ilon * height + ilat` where `ilon = (int)(lon + 540) % 360` and
 * `ilat = (int)(lat + 270) % 180`. So `ilat=0` is the south pole row,
 * `ilat=height-1` is the north pole row.
 */
export interface SCANCoverageBitmap {
  width: number;
  height: number;
  type: SCANType;
  /** Base64-encoded bit-packed coverage. */
  bits: string;
}

/**
 * `scan.heightGrid[bodyName]` response. `heights` is a base64-encoded
 * `Int16[width*height]` row-major in the same (lon+180)*height + (lat+90)
 * order as the coverage bitmap. Values are metres above the body's
 * reference radius; `minMetres` / `maxMetres` give the colour-ramp
 * extents without a full scan of the decoded array.
 *
 * PQS-backed on the fork side, so this resolves even without SCANsat
 * installed — operators should still gate display behind
 * `scan.maskBitmap` coverage if fog-of-war semantics are desired.
 */
export interface SCANHeightGrid {
  width: number;
  height: number;
  minMetres: number;
  maxMetres: number;
  /** Base64 Int16 little-endian per cell. */
  heights: string;
}

/**
 * One biome entry from `scan.biomeGrid[bodyName].biomes`. `colour` is a
 * packed RGB integer (0xRRGGBB) lifted from KSP's stock BiomeMap so the
 * client doesn't need a colour table of its own.
 */
export interface SCANBiomeEntry {
  name: string;
  displayName: string;
  colour: number;
}

/**
 * `scan.biomeGrid[bodyName]` response. `indices` is a base64 byte-per-
 * cell array; each byte is the position of the cell's biome in `biomes`
 * (or 0xFF for a null biome / a body without a BiomeMap). Same cell
 * order as scan.heightGrid + scan.maskBitmap.
 *
 * Stock BiomeMap-backed — works without SCANsat. Indices saturate at
 * 254; bodies with >254 biomes (unrealistic in stock) collapse the
 * tail.
 */
export interface SCANBiomeGrid {
  width: number;
  height: number;
  biomes: SCANBiomeEntry[];
  /** Base64 byte-per-cell. */
  indices: string;
}

/**
 * One scanner module on a `scan.scanningVessels` vessel. `type` is the
 * SCANsat `SCANtype` bit value (see SCAN_TYPE); a single vessel can carry
 * scanners of several types. `inRange` / `bestRange` reflect SCANsat's
 * own per-tick range gates: inRange means the vessel is between
 * `minAlt` and `maxAlt`, bestRange means it's at the high-fidelity
 * altitude. Below `minAlt` or above `maxAlt` both are false and the
 * scanner is idle.
 */
export interface SCANSensorEntry {
  type: number;
  fov: number;
  minAlt: number;
  maxAlt: number;
  bestAlt: number;
  inRange: boolean;
  bestRange: boolean;
}

/**
 * One entry from `scan.scanningVessels`. SCANsat tracks unloaded vessels
 * too, so this list is *cross-vessel by design* — a satellite mapping
 * Kerbin and a probe orbiting Mun both appear here at the same time.
 * `subLatitude` / `subLongitude` are the sub-satellite ground point;
 * the scanning footprint is a circle centred there with radius derived
 * from each sensor's `fov` and the body radius.
 */
export interface SCANScanningVessel {
  vesselId: string;
  vesselName: string;
  body: string;
  subLatitude: number;
  subLongitude: number;
  altitude: number;
  sensors: SCANSensorEntry[];
  /**
   * SCANsat's actual current ground-track FoV for this vessel in
   * degrees — reflected from the private `SCANcontroller.getFOV`
   * (the same number used to paint the in-flight overlay via
   * `drawGroundTrackTris`). This is the per-side latitude half-width.
   * Null when SCANsat is not installed or the vessel currently has
   * no in-range sensors.
   */
  groundTrackWidthDeg?: number | null;
  /**
   * Per-side longitude half-width in degrees, computed fork-side as
   * `groundTrackWidthDeg / cos(|subLat|)` and capped at 120°,
   * matching the widening SCANsat applies inside its coverage paint
   * loop. Null when SCANsat is not installed or the vessel has no
   * in-range sensors.
   */
  groundTrackLonHalfDeg?: number | null;
  /**
   * SCANsat's combined per-vessel `trackColor` (Color32). Use the
   * same tint on minimap footprints so the rendering matches the
   * in-game overlay. Null when SCANsat is not installed.
   */
  trackColor?: { r: number; g: number; b: number; a: number } | null;
}

/**
 * One anomaly from `scan.anomalies[bodyName]`. `known` is true once the
 * player has discovered the anomaly's position (SCANsat Anomaly scan);
 * `detail` is true once they have the name (AnomalyDetail scan). Pre-
 * discovery, the entry can still appear but with `known: false` — useful
 * for "this body has N anomalies, M discovered" readouts but not for
 * marker rendering.
 */
export interface SCANAnomalyEntry {
  name: string;
  latitude: number;
  longitude: number;
  known: boolean;
  detail: boolean;
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
  /** Stringified `Vessel.vesselType` enum (Probe, Lander, Ship, Plane, …). */
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
}
