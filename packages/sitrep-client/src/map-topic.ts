/**
 * The `mapTopic` compatibility shim's data: old-Telemachus-key → new SDK
 * stream topic (M2 design §6 "the `mapTopic` shim"; source of truth is
 * `m1-provider-taxonomy-design.md` §5's migration map, cross-checked against
 * every widget's real `dataRequirements`/`useDataValue` call in
 * `packages/components/src` — see `map-topic.coverage.test.ts` in
 * `@gonogo/core`, which enumerates the live widget key set and asserts every
 * key is either mapped here or listed in `TELEMACHUS_KNOWN_GAPS`).
 *
 * Two independent concerns live in this file:
 *
 * 1. **`redirectKinematicSubtopic`** (T3's original single-arg `mapTopic`,
 *    renamed) — a narrow, sourceId-agnostic safety net that redirects a
 *    handful of *new-SDK* raw topic strings onto the derived `vessel.state.*`
 *    surface, so nothing that already speaks the new topic namespace can
 *    reintroduce the dual-altitude wart (M1 §6.2, V-12). Identity fallback:
 *    safe to call on any topic string.
 * 2. **`mapTopic(sourceId, key)`** (this task, M2 Task 7) — the M3
 *    `useDataValue` migration table: old widget-facing `(dataSourceId, key)`
 *    pairs (today always `("data", "<Telemachus key>")`) → the new stream
 *    topic string, or `undefined` when there is no new home yet. `undefined`
 *    is the explicit "fall back to the legacy `DataSource` path" signal the
 *    `@gonogo/core` shim depends on — it is NOT an identity fallback, unlike
 *    (1) above; the two functions have deliberately incompatible defaults
 *    because they serve different callers (a shim needs to know when it
 *    can't route; a direct-topic safety net needs to always return
 *    something sane).
 *
 * Only `sourceId === "data"` (the Telemachus `DataSource`) is covered.
 * `"kos"`/`"kerbcast"`/other sources are deliberately NOT routed yet — their
 * data doesn't exist on the new SDK's wire in M2, so mapping them would
 * silently break working functionality (the shim would call `useStream` on a
 * topic nothing ever publishes, forever `undefined`, instead of the real
 * live `DataSource`). Wiring those sources through `mapTopic` is M3-adjacent
 * work for when they actually get channels.
 */

/** Kinematics → `vessel.state.*` routing (M1 §6.2/§8.2's V-12-prevention
 * rule: "`mapTopic` points kinematics at `vessel.state.*` derived subtopics
 * from the FIRST migrated widget"). Two input shapes are handled:
 * - **Short semantic keys** (`"altitude"`, `"velocity"`, `"position"`,
 *   `"orbitalSpeed"`) — forward-compatible shorthand some SDK-native callers
 *   may use.
 * - **Raw topic strings a widget might reach for directly** —
 *   `"vessel.flight.altitudeAsl"` is redirected to `"vessel.state.altitudeAsl"`
 *   even though the raw field genuinely exists on the wire, because binding a
 *   widget straight to it reproduces the dual-altitude wart `vessel.state`
 *   exists to kill. Same story for `"vessel.flight.orbitalSpeed"` →
 *   `"vessel.state.orbitalSpeed"` — `vessel.flight` carries `orbitalSpeed` on
 *   the wire; `vessel.orbit` is elements-only and has no such field, so a
 *   redirect keyed on that topic would never fire.
 *   Non-kinematic keys (surface-frame-only measurements with no
 *   elements-derived twin, e.g. `vessel.flight.mach`,
 *   `vessel.flight.dynamicPressureKPa`) are deliberately NOT redirected —
 *   those stay raw; there's no dual representation to collapse.
 */
const KINEMATIC_REDIRECTS: Readonly<Record<string, string>> = {
  position: "vessel.state.position",
  velocity: "vessel.state.velocity",
  altitude: "vessel.state.altitudeAsl",
  altitudeAsl: "vessel.state.altitudeAsl",
  orbitalSpeed: "vessel.state.orbitalSpeed",
  "vessel.flight.altitudeAsl": "vessel.state.altitudeAsl",
  "vessel.flight.orbitalSpeed": "vessel.state.orbitalSpeed",
};

/**
 * Resolve a *new-SDK* topic string to the topic it should actually be read
 * from. Kinematics (position/velocity/altitude/orbital speed) always
 * resolve to `vessel.state.*`; everything else passes through unchanged.
 * Identity fallback — safe to call on every topic, not just kinematic ones.
 */
export function redirectKinematicSubtopic(topic: string): string {
  return KINEMATIC_REDIRECTS[topic] ?? topic;
}

// ---------------------------------------------------------------------------
// The M3 `useDataValue` migration table (M2 Task 7).
// ---------------------------------------------------------------------------

/**
 * Old Telemachus key (as it appears in `dataRequirements`/`useDataValue`
 * calls in `packages/components/src`) → new stream topic. "derived" entries
 * are SDK-computed values (elements propagated at view-UT, quality-picked,
 * etc.) exposed as plain topic strings via `vessel.state`'s `fields: true`
 * subtopics (M2 §2.4) — `useStream` doesn't distinguish raw from derived, so
 * the shim needs zero selector machinery.
 *
 * Source: `m1-provider-taxonomy-design.md` §5.1 "Clean homes", extended with
 * every literal key actually found in `packages/components/src`'s
 * `dataRequirements` arrays and `useDataValue("data", …)` call sites.
 */
const TELEMACHUS_CLEAN_HOMES: Readonly<Record<string, string>> = {
  // --- vessel.state (derived, quality-picked kinematics — V-12) ---
  "v.altitude": "vessel.state.altitudeAsl",
  "v.orbitalVelocity": "vessel.state.orbitalSpeed",
  "o.orbitalSpeed": "vessel.state.orbitalSpeed",
  "v.missionTime": "vessel.state.met",
  "o.ApA": "vessel.state.apoapsisAlt",
  "o.PeA": "vessel.state.periapsisAlt",
  "o.period": "vessel.state.period",
  "o.timeToAp": "vessel.state.timeToAp",
  "o.timeToPe": "vessel.state.timeToPe",
  "o.trueAnomaly": "vessel.state.trueAnomaly",

  // --- vessel.flight (raw measurements) ---
  "v.lat": "vessel.flight.latitude",
  "v.long": "vessel.flight.longitude",
  "v.heightFromTerrain": "vessel.flight.altitudeTerrain",
  "v.verticalSpeed": "vessel.flight.verticalSpeed",
  "v.surfaceSpeed": "vessel.flight.surfaceSpeed",
  "v.dynamicPressure": "vessel.flight.dynamicPressureKPa",
  "v.mach": "vessel.flight.mach",
  "v.atmosphericDensity": "vessel.flight.atmDensity",

  // --- vessel.attitude (raw; *2 CoM-frame quartet dropped, see gaps) ---
  "n.heading": "vessel.attitude.heading",
  "n.pitch": "vessel.attitude.pitch",
  "n.roll": "vessel.attitude.roll",

  // --- vessel.orbit (raw elements + structured fields) ---
  "o.sma": "vessel.orbit.sma",
  "o.eccentricity": "vessel.orbit.ecc",
  "o.inclination": "vessel.orbit.inc",
  "o.lan": "vessel.orbit.lan",
  "o.argumentOfPeriapsis": "vessel.orbit.argPe",
  "o.referenceBody": "vessel.orbit.referenceBodyIndex",
  "o.maneuverNodes": "vessel.maneuver.nodes",
  "o.encounterExists": "vessel.orbit.encounter",
  "o.encounterBody": "vessel.orbit.encounter",
  "o.encounterTime": "vessel.orbit.encounter",

  // --- vessel.identity ---
  "v.name": "vessel.identity.name",
  "v.body": "vessel.identity.parentBodyIndex",
  "v.situationString": "vessel.identity.situation",

  // --- vessel.control ---
  "f.throttle": "vessel.control.throttle",
  "f.sasEnabled": "vessel.control.sas",
  "f.sasMode": "vessel.control.sasMode",
  "v.rcsValue": "vessel.control.rcs",

  // --- vessel.structure / vessel.crew ---
  "v.currentStage": "vessel.structure.currentStage",
  "v.crewCount": "vessel.crew.count",

  // --- vessel.thermal ---
  "therm.hottestPartTemp": "vessel.thermal.hottestPart.skinTemp",
  "therm.hottestPartTempRatio": "vessel.thermal.maxInternalTempRatio",
  "therm.hottestPartMaxTemp": "vessel.thermal.hottestPart.skinMaxTemp",

  // --- vessel.comms ---
  "comm.connected": "vessel.comms.connected",
  "comm.signalStrength": "vessel.comms.signalStrength",
  "comm.controlState": "vessel.comms.controlState",
  "comm.controlStateName": "vessel.comms.controlState",
  "comm.signalDelay": "comms.delay", // provider capability channel, not vessel.*

  // --- vessel.propulsion ---
  "dv.currentTWR": "vessel.propulsion.twr", // derived: currentThrust / (totalMass * g)

  // --- vessel.resources (parametric — see PARAMETRIC_RULES below for the
  // r.resource[X]/r.resourceMax[X] family) ---

  // --- vessel.target ---
  "tar.name": "vessel.target.name",
  "tar.type": "vessel.target.kind",
  "tar.o.relativeVelocity": "vessel.target.relativeVelocity",
  "tar.o.sma": "vessel.target.orbit.sma",
  "tar.o.inclination": "vessel.target.orbit.inc",
  "tar.o.lan": "vessel.target.orbit.lan",
  "tar.o.argumentOfPeriapsis": "vessel.target.orbit.argPe",
  "dock.x": "vessel.target.relativePosition",
  "dock.y": "vessel.target.relativePosition",

  // --- system.bodies (raw static array; b.<field>[i] all read the one
  // array topic and index in — no per-body subtopic in M1) ---
  "b.number": "system.bodies",

  // --- time.warp ---
  "t.currentRate": "time.warp.warpRate",
  "t.timeWarp": "time.warp.warpRateIndex",
  "t.warpMode": "time.warp.warpMode",
  "t.isPaused": "time.warp.paused",
};

/** `b.<field>[i]` parametric family (name/radius/soi/mass/geeASL/
 * rotationPeriod/o.sma.../hasAtmosphere/... at index i) → the one raw
 * `system.bodies` array topic; a migrated widget indexes into it. Excludes
 * `rotationAngle`/`rotates`, which are derived and have no subtopic yet
 * (§ known gaps). */
const BODY_INDEXED_CLEAN = /^b\.(?!rotationAngle\[|rotates\[)[\w.]+\[-?\d+\]$/;
const BODY_INDEXED_GAP = /^b\.(rotationAngle|rotates)\[-?\d+\]$/;

/** `r.resource[X]` / `r.resourceMax[X]` (vessel-total) → `vessel.resources`
 * map, one field object per resource name. `r.resourceCurrent(Max)[X]`
 * (current-STAGE totals) has no home — `vessel.resources` is vessel-total
 * only (M1 §2.2); stage-scoped resource splits are the same G-14 stage-sim
 * gap as `dv.stages`. */
const RESOURCE_VESSEL_TOTAL = /^r\.resource(Max)?\[([^\]]+)\]$/;
const RESOURCE_STAGE_SCOPED = /^r\.resourceCurrent(Max)?\[([^\]]+)\]$/;

/**
 * Old keys with NO new home yet — the M1 §5.2 gaps table, extended with
 * every gapped key actually found in widget `dataRequirements`/
 * `useDataValue` call sites. Exported so `@gonogo/core`'s coverage test can
 * assert "mapped OR declared gap" without a silent third case.
 */
export const TELEMACHUS_KNOWN_GAPS: ReadonlySet<string> = new Set([
  // --- the biggest vessel-scope gap: no roster channel yet ---
  "tar.availableVessels",

  // --- land.* — no channel; terrain-touching fields need a terrain asset ---
  "land.timeToImpact",
  "land.speedAtImpact",
  "land.bestSpeedAtImpact",
  "land.suicideBurnCountdown",
  "land.predictedLat",
  "land.predictedLon",
  "land.slopeAngle",

  // --- full patched-conic chain not captured, only next-patch (encounter) ---
  "o.orbitPatches",

  // --- not captured (G-11) ---
  "v.atmosphericTemperature",
  "v.externalTemperature",

  // --- thermal detail beyond headline ratios (G-12) ---
  "therm.hottestPartName",
  "therm.hottestEngineTemp",
  "therm.hottestEngineMaxTemp",
  "therm.hottestEngineTempRatio",
  "therm.heatShieldTempCelsius",
  "therm.heatShieldFlux",
  "therm.anyEnginesOverheating",

  // --- roster/capacity (G-13); count-only lands in vessel.crew.count ---
  "v.crew",
  "v.crewCapacity",

  // --- needs capture add, not derivable client-side (G-10) ---
  "v.biome",
  "v.landedAt",

  // --- stage-sim (G-14); vessel-level burn estimate is the interim ---
  "dv.stageCount",
  "dv.stages",
  "dv.totalDVVac",
  "dv.totalDVASL",
  "dv.totalDVActual",
  "dv.totalBurnTime",

  // --- parts surface — own ASSET-class design, out of M1 ---
  "v.topology",
  "v.topologySeq",
  "robotics.available",
  "robotics.rotors",
  "robotics.servos",

  // --- M2 event stream (ReliableOrdered), not this milestone's state model ---
  "crash.hasRecent",
  "crash.lastCrash",

  // --- partial via vessel.comms.controlState; the rest is a capture one-liner ---
  "v.isControllable",
  "f.precisionControl",

  // --- derived quantities with no named field on any M1/M2 channel yet ---
  "v.horizontalVelocity",
  "v.isEVA",
  "v.splashed",
  "v.angleToPrograde",
  "o.ApR",
  "o.PeR",
  "o.radius",
  "o.closestTgtApprUT",
  "o.nextApsisType",
  "o.timeToNextApsis",
  "tar.distance",
  "tar.o.PeA",
  "tar.o.period",
  "tar.o.trueAnomaly",
  "dock.ax",
  "dock.ay",
  "dock.az",

  // --- *2 CoM-attitude quartet deliberately not reproduced (V-9) ---
  "n.heading2",
  "n.pitch2",
  "n.roll2",

  // --- meta, not a stream (Meta.Quality via stream status, not useStream) ---
  "a.physicsMode",

  // --- not a stream at all: sdk.view.ut() / meta.validAt ---
  "t.universalTime",

  // --- out of vessel-provider scope by design — separate provider families ---
  "career.funds",
  "career.mode",
  "career.reputation",
  "career.science",
  "kc.crewRoster",
  "kc.facilityLevels",
  "kc.launchSite",
  "kc.launchSites",
  "kc.padOccupied",
  "kc.padVesselTitle",
  "kc.partsAvailable",
  "kc.savedShips",
  "kc.scene",
  "contracts.active",
  "contracts.offered",
  "contracts.completedRecent",
  "strategies.all",
  "tech.nodes",
  "sci.count",
  "sci.dataAmount",
  "sci.experiments",
  "sci.experimentBreakdown",
  "sci.instruments",
  "s.sensor.temp",
  "s.sensor.pres",
  "s.sensor.grav",
  "s.sensor.acc",
  "deployed.bases",
  "deployed.available",
  "mh.score",
  "mh.objectives",
  "mh.available",
  "mh.finished",
  "mh.name",
  "mh.outcome",
  "mh.phase",
  "scan.available",
  "scan.scanningVessels",
  "ksp.canRevertToEditor",
  "ksp.canRevertToLaunch",
]);

/**
 * Resolve a widget-facing `(dataSourceId, key)` pair — as passed to
 * `useDataValue` today — to the new SDK stream topic it should read from.
 *
 * Returns `undefined` when there is no mapping: either `dataSourceId` isn't
 * the Telemachus `"data"` source (nothing else is wired to the new SDK in
 * M2), or `key` is a known, explicitly-tracked gap (`TELEMACHUS_KNOWN_GAPS`),
 * or `key` is genuinely unrecognized. In every `undefined` case the
 * `@gonogo/core` `useDataValue` shim falls back to the legacy `DataSource`
 * path — this function intentionally does NOT identity-fallback (contrast
 * with `redirectKinematicSubtopic` above).
 */
export function mapTopic(
  dataSourceId: string,
  key: string,
): string | undefined {
  if (dataSourceId !== "data") return undefined;

  const clean = TELEMACHUS_CLEAN_HOMES[key];
  if (clean !== undefined) return clean;

  if (BODY_INDEXED_CLEAN.test(key)) return "system.bodies";
  if (BODY_INDEXED_GAP.test(key)) return undefined;

  const resourceMatch = RESOURCE_VESSEL_TOTAL.exec(key);
  if (resourceMatch) {
    const [, isMax, name] = resourceMatch;
    return `vessel.resources.${name}.${isMax ? "max" : "current"}`;
  }
  if (RESOURCE_STAGE_SCOPED.test(key)) return undefined;

  return undefined;
}

/**
 * `true` when `key` is a Telemachus key with a deliberately-tracked absence
 * of a new home (as opposed to simply never having been audited). Used by
 * the coverage test to distinguish "known gap" from "silent miss".
 */
export function isKnownTelemachusGap(
  dataSourceId: string,
  key: string,
): boolean {
  if (dataSourceId !== "data") return false;
  if (TELEMACHUS_KNOWN_GAPS.has(key)) return true;
  return BODY_INDEXED_GAP.test(key) || RESOURCE_STAGE_SCOPED.test(key);
}
