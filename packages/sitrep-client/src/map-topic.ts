/**
 * The `mapTopic` compatibility shim's data: old-Telemachus-key → new SDK
 * stream topic, cross-checked against every widget's real
 * `dataRequirements`/`useDataValue` call in `packages/components/src` — see
 * `map-topic.coverage.test.ts` in `@ksp-gonogo/core`, which enumerates the
 * live widget key set and asserts every key is either mapped here or listed
 * in `TELEMACHUS_KNOWN_GAPS`.
 *
 * Two independent concerns live in this file:
 *
 * 1. **`redirectKinematicSubtopic`** (originally a single-arg `mapTopic`,
 *    renamed) — a narrow, sourceId-agnostic safety net that redirects a
 *    handful of *new-SDK* raw topic strings onto the derived `vessel.state.*`
 *    surface, so nothing that already speaks the new topic namespace can
 *    reintroduce the dual-altitude wart. Identity fallback:
 *    safe to call on any topic string.
 * 2. **`mapTopic(sourceId, key)`** — the
 *    `useDataValue` migration table: old widget-facing `(dataSourceId, key)`
 *    pairs (today always `("data", "<Telemachus key>")`) → the new stream
 *    topic string, or `undefined` when there is no new home yet. `undefined`
 *    is the explicit "fall back to the legacy `DataSource` path" signal the
 *    `@ksp-gonogo/core` shim depends on — it is NOT an identity fallback, unlike
 *    (1) above; the two functions have deliberately incompatible defaults
 *    because they serve different callers (a shim needs to know when it
 *    can't route; a direct-topic safety net needs to always return
 *    something sane).
 *
 * `sourceId === "data"` (the Telemachus `DataSource`) is the main table.
 * `sourceId === "kos"` is ALSO routed: the mod publishes
 * native `kos.processors` push telemetry plus the dynamic
 * `kos.compute.<id>.<field>` compute namespace, so those topics DO exist on
 * the wire. `"kerbcast"`/other sources remain deliberately NOT routed — their
 * data still doesn't exist on the new SDK's wire, so mapping them would
 * silently break working functionality (the shim would call `useStream` on a
 * topic nothing ever publishes, forever `undefined`, instead of the real
 * live `DataSource`).
 */

/** Kinematics → `vessel.state.*` routing: `mapTopic` points kinematics at
 * `vessel.state.*` derived subtopics from the first migrated widget. Two
 * input shapes are handled:
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
// The `useDataValue` migration table.
// ---------------------------------------------------------------------------

/**
 * Old Telemachus key (as it appears in `dataRequirements`/`useDataValue`
 * calls in `packages/components/src`) → new stream topic. "derived" entries
 * are SDK-computed values (elements propagated at view-UT, quality-picked,
 * etc.) exposed as plain topic strings via `vessel.state`'s `fields: true`
 * subtopics — `useStream` doesn't distinguish raw from derived, so
 * the shim needs zero selector machinery.
 *
 * Extended with every literal key actually found in
 * `packages/components/src`'s `dataRequirements` arrays and
 * `useDataValue("data", ...)` call sites.
 */
export const TELEMACHUS_CLEAN_HOMES: Readonly<Record<string, string>> = {
  // --- vessel.state (derived, quality-picked kinematics) ---
  "v.altitude": "vessel.state.altitudeAsl",
  "v.orbitalVelocity": "vessel.state.orbitalSpeed",
  "o.orbitalSpeed": "vessel.state.orbitalSpeed",

  // --- vessel.state (derivable orbital fields — mapped on the wire now
  // that deriveVesselState actually produces them, see vessel-state.ts) ---
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
  // v.atmosphericTemperature / v.externalTemperature are mapped on the wire:
  // plain raw fields on VesselFlight, not captured by the original raw-field
  // walk.
  "v.atmosphericTemperature": "vessel.flight.atmosphericTemperature",
  "v.externalTemperature": "vessel.flight.externalTemperature",

  // --- vessel.attitude (raw; two named frames — see VesselAttitude.cs's
  // class doc for why *2 isn't a numeric-suffix pair) ---
  "n.heading": "vessel.attitude.heading",
  "n.pitch": "vessel.attitude.pitch",
  "n.roll": "vessel.attitude.roll",
  // n.heading2/pitch2/roll2: the genuinely distinct ROOT-PART-referenced
  // frame (as opposed to the CoM-referenced n.heading/pitch/roll above) —
  // see KspHost.BuildAttitude's doc comment for the shared surface-frame
  // construction the two only differ by POSITION reference on.
  "n.heading2": "vessel.attitude.headingRootFrame",
  "n.pitch2": "vessel.attitude.pitchRootFrame",
  "n.roll2": "vessel.attitude.rollRootFrame",

  // --- vessel.orbit (raw elements + structured fields) ---
  "o.sma": "vessel.orbit.sma",
  "o.eccentricity": "vessel.orbit.ecc",
  "o.inclination": "vessel.orbit.inc",
  "o.lan": "vessel.orbit.lan",
  "o.argumentOfPeriapsis": "vessel.orbit.argPe",

  // --- vessel.identity ---
  "v.name": "vessel.identity.name",

  // --- vessel.state (derived body-NAME display maps). The mod's new homes
  // for these are `vessel.identity.parentBodyIndex` /
  // `vessel.orbit.referenceBodyIndex`, both `int?` INDEXES into
  // `system.bodies`, NOT the body-NAME strings ~14 widgets read and feed to
  // `getBody(id: string)`. `deriveVesselState` (vessel-state.ts) now resolves
  // each index against `system.bodies`'s per-body `name`/`index` and exposes
  // the resolved name as a `vessel.state.*` field subtopic — same client-side
  // display-map pattern as the seven orbital fields above, so the widgets get
  // the NAME string transparently with zero per-widget change. ---
  "v.body": "vessel.state.parentBodyName",
  "o.referenceBody": "vessel.state.referenceBodyName",

  // --- vessel.state (derived enum-ordinal → NAME display maps — the
  // enum-ordinal→string-name shape-mismatch migration). Each mod field is a
  // NUMERIC contract-enum ordinal on the wire (`VesselViewProvider` serializes
  // `(int)...`); the widgets read the STRING name (or, for `comm.controlState`,
  // a Telemachus 0/1/2 numeric). `deriveVesselState` resolves each ordinal
  // against the contract's C#-declared enum order and exposes the widget-shaped
  // value as a `vessel.state.*` field subtopic — same client-side display-map
  // pattern as the body-NAME maps above, zero per-widget change:
  //  - situationName            (Situation enum → name; ScienceBench)
  //  - sasModeName              (SasMode enum → name; Navball's SAS_MODES)
  //  - targetKind               (TargetKind enum → widget string; Body→"CelestialBody")
  //  - commsControlStateName    (ControlState enum → name; CommSignal label/tone)
  //  - commsControlStateOrdinal (ControlState enum → CommSignal's 0/1/2 level)
  // ---
  "v.situationString": "vessel.state.situationName",
  "f.sasMode": "vessel.state.sasModeName",
  "tar.type": "vessel.state.targetKind",
  "comm.controlStateName": "vessel.state.commsControlStateName",
  "comm.controlState": "vessel.state.commsControlStateOrdinal",

  // --- vessel.state (derived, client-side shape-mismatch fixes): three more
  // display maps + one range-rate derivation off already-served channels,
  // same pattern as the enum maps above.
  //  - encounterExists/encounterBody/encounterTime  <- vessel.orbit.encounter
  //    (nullable OrbitEncounter record). exists = signed -1/0/1 keyed off
  //    TransitionType (Encounter→1, Escape→-1, else 0 — the sign carries the
  //    escape-vs-encounter distinction OrbitalEventChips branches on); body =
  //    bodyIndex resolved to a NAME via system.bodies; time = transitionUt.
  //  - targetRelativeSpeed <- vessel.target.relativePosition/relativeVelocity
  //    (both Vec3): the SIGNED range-rate dot(relPos,relVel)/|relPos| the old
  //    scalar tar.o.relativeVelocity carried (positive=opening, <0=closing).
  // ---
  "o.encounterExists": "vessel.state.encounterExists",
  "o.encounterBody": "vessel.state.encounterBody",
  "o.encounterTime": "vessel.state.encounterTime",
  "tar.o.relativeVelocity": "vessel.state.targetRelativeSpeed",

  // --- vessel.state (derived client-side): the "derived quantities with no
  // named field" cluster that IS cleanly recoverable from data already on
  // the wire. Same display-map/derivation pattern as above, zero
  // per-widget change:
  //  - apoapsisRadius/periapsisRadius (o.ApR/o.PeR) = sma·(1±ecc), the apsis
  //    RADII from the body center — straight off the orbit elements, no body
  //    table (unlike apoapsisAlt, which subtracts the radius).
  //  - orbitalRadius (o.radius) = |propagated position| — current distance
  //    from the body center (ManeuverPlanner's vis-viva computeMu input).
  //  - nextApsisType/timeToNextApsis (o.nextApsisType/o.timeToNextApsis):
  //    picked from the already-derived timeToAp/timeToPe (1=Ap, -1=Pe).
  //  - horizontalSpeed (v.horizontalVelocity) = sqrt(surfaceSpeed² -
  //    verticalSpeed²), the measured-basis surface-tangent speed.
  //  - targetDistance (tar.distance) = |vessel.target.relativePosition|.
  //  - targetPeriapsisAlt/targetPeriod/targetTrueAnomaly (tar.o.PeA/period/
  //    trueAnomaly): the target's own orbit (vessel.target.orbit reuses the
  //    VesselOrbit shape) propagated to the same viewUt as the self vessel.
  // ---
  "o.ApR": "vessel.state.apoapsisRadius",
  "o.PeR": "vessel.state.periapsisRadius",
  "o.radius": "vessel.state.orbitalRadius",
  "o.nextApsisType": "vessel.state.nextApsisType",
  "o.timeToNextApsis": "vessel.state.timeToNextApsis",
  "v.horizontalVelocity": "vessel.state.horizontalSpeed",
  "tar.distance": "vessel.state.targetDistance",
  "tar.o.PeA": "vessel.state.targetPeriapsisAlt",
  "tar.o.period": "vessel.state.targetPeriod",
  "tar.o.trueAnomaly": "vessel.state.targetTrueAnomaly",

  // --- Shared client-side derivations off channels already on the wire,
  // used by Twr, Navball, CrewManifest, GroundSurvey, ActionGroup ag1..10,
  // and DistanceToTarget. Each is a `vessel.state.*` field
  // `deriveVesselState` now produces (see
  // vessel-state.ts), same display-map pattern as elsewhere in this table:
  //  - twr (dv.currentTWR) = currentThrust/(totalMass·g) off vessel.propulsion.
  //  - isControllable (v.isControllable) from vessel.comms.controlState LEVEL.
  //  - isEVA/isSplashed (v.isEVA/v.splashed) from vessel.identity.
  //  - actionGroup1..10 (v.ag{n}Value) from vessel.control.actionGroups[]
  //    (dynamic keyed map `vessel.state.actionGroups` also produced for AGX).
  //  - closestApproachUt (o.closestTgtApprUT) = two-body closest-approach
  //    solve over vessel.orbit + vessel.target.orbit (propagation.ts).
  // ---
  "dv.currentTWR": "vessel.state.twr",
  "v.isControllable": "vessel.state.isControllable",
  "v.isEVA": "vessel.state.isEVA",
  "v.splashed": "vessel.state.isSplashed",
  "v.ag1Value": "vessel.state.actionGroup1",
  "v.ag2Value": "vessel.state.actionGroup2",
  "v.ag3Value": "vessel.state.actionGroup3",
  "v.ag4Value": "vessel.state.actionGroup4",
  "v.ag5Value": "vessel.state.actionGroup5",
  "v.ag6Value": "vessel.state.actionGroup6",
  "v.ag7Value": "vessel.state.actionGroup7",
  "v.ag8Value": "vessel.state.actionGroup8",
  "v.ag9Value": "vessel.state.actionGroup9",
  "v.ag10Value": "vessel.state.actionGroup10",
  "o.closestTgtApprUT": "vessel.state.closestApproachUt",

  // --- land.* ballistic scalars: closed-form vacuum landing solves derived
  // client-side (vessel-state.ts `deriveLanding`) off channels already on the
  // wire — no terrain asset, no drag model, no mod-side change. Gravity is
  // `mu/(radius+altitudeAsl)²` from vessel.orbit.mu (parent-body GM, valid in
  // the measured basis) + the system.bodies radius; the fall/burn kinematics
  // are off vessel.flight; the suicide-burn thrust ceiling is off
  // vessel.propulsion. MEASURED basis only (null while orbiting). The three
  // remaining land.* keys (predictedLat/Lon/slopeAngle) need a trajectory
  // integrator + terrain asset and stay in TELEMACHUS_KNOWN_GAPS below. ---
  "land.timeToImpact": "vessel.state.landingTimeToImpact",
  "land.speedAtImpact": "vessel.state.landingSpeedAtImpact",
  "land.bestSpeedAtImpact": "vessel.state.landingBestSpeedAtImpact",
  "land.suicideBurnCountdown": "vessel.state.landingSuicideBurnCountdown",

  // --- system.state (derived) — b.number is a plain COUNT; system.bodies is
  // the raw body ARRAY. `systemStateChannel` (system-state.ts) derives
  // `bodyCount = bodies.length` on its own SYSTEM-scoped derived channel
  // (not vessel.state — the count must stay live even with no active vessel).
  "b.number": "system.state.bodyCount",

  // --- dock.x/dock.y — the two lateral docking-offset scalars (metres) are
  // simply the x/y components of vessel.dock.relativePosition (the Vec3
  // DistanceToTarget already uses verbatim as their drop-in replacement,
  // rendering `${x.toFixed(2)} m`). Mapped via the raw-field-subtopic walk
  // (`resolveRawFieldSubtopic`) into the Vec3 — no derived field needed, same
  // nested-walk form as the career.status.* sub-tree reads.
  "dock.x": "vessel.dock.relativePosition.x",
  "dock.y": "vessel.dock.relativePosition.y",

  // --- vessel.surface capture-add: biome + landedAt now ship on the
  // mod wire (VesselSurface.Biome/LandedAt), so these two — previously gapped
  // as "needs capture add" — migrate as raw-field walks. vessel.surface is
  // null while ORBITING/ESCAPING (capture-side guard), so widgets see these
  // only near a surface, which matches the old Telemachus semantics.
  "v.biome": "vessel.surface.biome",
  "v.landedAt": "vessel.surface.landedAt",

  // --- vessel.control ---
  "f.throttle": "vessel.control.throttle",
  "f.sasEnabled": "vessel.control.sas",
  "v.rcsValue": "vessel.control.rcs",
  "v.sasValue": "vessel.control.sas",
  "v.gearValue": "vessel.control.gear",
  "v.brakeValue": "vessel.control.brakes",
  "v.lightValue": "vessel.control.lights",
  // v.abortValue: VesselControl.Abort now ships on the
  // wire — see TELEMACHUS_KNOWN_GAPS's matching (removed) entry.
  "v.abortValue": "vessel.control.abort",
  // v.precisionControlValue / f.precisionControl are mapped on the wire:
  // VesselControl now carries a plain `precisionControl` field
  // alongside `abort` — same raw-field walk as the other vessel.control
  // booleans above. ActionGroup's toggle read AND Navball's precision-mode
  // read both land on the same field.
  "v.precisionControlValue": "vessel.control.precisionControl",
  "f.precisionControl": "vessel.control.precisionControl",

  // --- vessel.structure / vessel.crew ---
  "v.currentStage": "vessel.structure.currentStage",
  "v.crewCount": "vessel.crew.count",
  // v.crew / v.crewCapacity are mapped on the wire: the full
  // roster + capacity now ship alongside the plain count above.
  "v.crew": "vessel.crew.crew",
  "v.crewCapacity": "vessel.crew.capacity",

  // --- vessel.thermal ---
  "therm.hottestPartTemp": "vessel.thermal.hottestPart.skinTemp",
  "therm.hottestPartTempRatio": "vessel.thermal.maxInternalTempRatio",
  "therm.hottestPartMaxTemp": "vessel.thermal.hottestPart.skinMaxTemp",
  // therm.hottestPartName is mapped on the wire: ThermalHottestPart now
  // carries a Name field (Part.partInfo.title, falling back to Part.name —
  // the same convention VesselPart.title already uses).
  "therm.hottestPartName": "vessel.thermal.hottestPart.name",

  // --- heat-shield thermal. VesselThermal now carries the hottest ablative
  // heat shield's temperature (°C) and its ablator heat flux (kW), captured
  // off the part's ModuleAblator. Plain raw-field walks onto the two new
  // fields — ThermalStatus reads both as plain numbers.
  "therm.heatShieldTempCelsius": "vessel.thermal.heatShieldTempCelsius",
  "therm.heatShieldFlux": "vessel.thermal.heatShieldFlux",

  // --- engine thermal. VesselThermal now scopes the same hottest-by-ratio
  // tracking to engine parts only (any part carrying a ModuleEngines
  // module) — raw Kelvin readings, same unit convention as hottestPart's
  // own fields; ThermalStatus converts to Celsius client-side (unchanged).
  "therm.hottestEngineTemp": "vessel.thermal.hottestEngineTemp",
  "therm.hottestEngineMaxTemp": "vessel.thermal.hottestEngineMaxTemp",
  "therm.hottestEngineTempRatio": "vessel.thermal.hottestEngineTempRatio",
  "therm.anyEnginesOverheating": "vessel.thermal.anyEnginesOverheating",

  // --- vessel.comms ---
  "comm.connected": "vessel.comms.connected",
  "comm.signalStrength": "vessel.comms.signalStrength",
  // comm.signalDelay -> comms.delay.oneWaySeconds: gonogo's OWN SignalDelay
  // authority (TrueNow), live on the wire via CommsCoreUplink. CommSignal's
  // formatDelay reads a plain seconds number.
  "comm.signalDelay": "comms.delay.oneWaySeconds",

  // --- vessel.resources (parametric — see PARAMETRIC_RULES below for the
  // r.resource[X]/r.resourceMax[X] family) ---

  // --- vessel.target ---
  "tar.name": "vessel.target.name",
  "tar.o.sma": "vessel.target.orbit.sma",
  "tar.o.inclination": "vessel.target.orbit.inc",
  "tar.o.lan": "vessel.target.orbit.lan",
  "tar.o.argumentOfPeriapsis": "vessel.target.orbit.argPe",

  // --- time.warp ---
  "t.currentRate": "time.warp.warpRate",
  "t.timeWarp": "time.warp.warpRateIndex",
  "t.warpMode": "time.warp.warpMode",
  "t.isPaused": "time.warp.paused",

  // --- DistanceToTarget/TargetPicker dock+roster migration. These are NEW
  // widget-facing keys (no legacy equivalent — added by the migrating
  // widgets themselves) that expose the raw Vec3
  // fields so the widget can derive a scalar/angle client-side and merge it
  // with the still-legacy read via a `??` fallback — the same
  // MIXED-source-within-one-render pattern CurrentOrbit's own migration
  // established. See DistanceToTarget/index.tsx's
  // `vecMagnitude`/`deriveDockAngles`. Of the legacy keys that pattern backs,
  // `tar.distance`/`tar.o.relativeVelocity`/`dock.x`/`dock.y` have since been
  // mapped on the wire (they ARE cleanly derivable — see the CLEAN_HOMES
  // blocks above); only the docking-ORIENTATION angles
  // `dock.ax`/`dock.ay`/`dock.az` stay gapped (no ax/ay/az decomposition on
  // the wire, only a single ForwardDot — see TELEMACHUS_KNOWN_GAPS below). ---
  "tar.relativePosition": "vessel.target.relativePosition",
  "tar.relativeVelocityVec": "vessel.target.relativeVelocity",
  // vessel.dock is null whenever the target isn't a docking port with a
  // free port on the active vessel (DockAlignment's own doc comment,
  // mod/Sitrep.Host/VesselViewProvider.cs) — undefined here means "not a
  // docking scenario", not "not loaded yet".
  "dock.relativePosition": "vessel.dock.relativePosition",
  "dock.relativeVelocityVec": "vessel.dock.relativeVelocity",
  "dock.distanceScalar": "vessel.dock.distance",
  "dock.forwardDot": "vessel.dock.forwardDot",

  // --- ManeuverPlanner node-id command bridge. NEW
  // widget-facing key (no legacy equivalent) exposing the raw
  // `vessel.maneuver.nodes` array purely so the widget can read each node's
  // now-round-tripping `id` and pass the real guid into the
  // update/remove commands instead of a positional array index. See
  // ManeuverPlanner/index.tsx's `resolveNodeId`. ---
  "o.maneuverNodeIds": "vessel.maneuver.nodes",

  // --- o.orbitPatches / o.maneuverNodes: the mod now walks the full
  // patched-conic chain (Orbit.nextPatch, `mod/Sitrep.Contract/
  // OrbitPatch.cs`) and streams it on `vessel.orbit.patches` (current
  // trajectory) and each `vessel.maneuver.nodes[].patches` (post-burn
  // trajectory). `vessel.state.orbitPatches` (vessel-state.ts) reshapes the
  // former into the exact legacy `OrbitPatch[]` shape MapView/
  // trajectory.ts's `predictGroundTrack` already consume — a pure field
  // rename, no client math needed (the mod's `OrbitPatch` already ships
  // body-name strings + the same PeA/ApA/semiLatusRectum/semiMinorAxis
  // fields KSP itself computes). `o.maneuverNodes` needs the SAME reshape
  // per node plus the `[dvRadial,dvNormal,dvPrograde]` tuple and a flatten
  // of `orbitPatches[0]` onto the node's own headline fields — that lives
  // on its own small derived channel (`maneuver-legacy.ts`'s
  // `vessel.maneuver.legacy`), kept separate from `vessel.state` so this
  // reshape's `vessel.maneuver` input doesn't widen every OTHER
  // `vessel.state.*` consumer's carried-channels requirement (see that
  // file's own doc comment). ---
  "o.orbitPatches": "vessel.state.orbitPatches",
  "o.maneuverNodes": "vessel.maneuver.legacy.nodes",

  // --- land.predictedLat / land.predictedLon: a client derivation on the
  // same orbit-patch chain (NO mod-side terrain/impact predictor — see
  // `vessel-state.ts`'s `derivePredictedImpact`/`findImpactPoint` in
  // `orbit-patches.ts`), horizon-bounded off the existing closed-form
  // `landingTimeToImpact` estimate so the walk only ever runs while a
  // landing is actually imminent. Vacuum-exact; on an atmospheric body this
  // ignores drag (same limitation Telemachus's own — nonexistent —
  // implementation had; matches/beats it, doesn't regress it).
  // `land.slopeAngle` stays gapped below — it needs a terrain heightmap
  // this client derivation has no source for. ---
  "land.predictedLat": "vessel.state.landingPredictedLat",
  "land.predictedLon": "vessel.state.landingPredictedLon",

  // --- TargetPicker roster. NEW shape — {vessels:
  // [{vesselId, name, vesselType, situation, bodyIndex}]}, no position/
  // distance field (system.vessels' own doc comment,
  // mod/Sitrep.Host/SystemViewProvider.cs) — TargetPicker normalizes both
  // shapes into a common display type client-side; see index.tsx's
  // `normalizeRoster`. ---
  "tar.availableVessels": "system.vessels",

  // --- career.status economy scalars. Clean 1:1 raw-field
  // reads — CareerViewProvider.BuildEconomy (mod/Sitrep.Host/
  // CareerViewProvider.cs) republishes Funding/Reputation/R&D science as
  // plain nullable doubles, same shape the widgets already expect. The
  // sibling groups (facilities/contracts/strategies/tech) do NOT get the
  // same clean treatment — see the TELEMACHUS_KNOWN_GAPS entries below for
  // why each one is a real shape mismatch, not an oversight. ---
  "career.funds": "career.status.economy.funds",
  "career.reputation": "career.status.economy.reputation",
  "career.science": "career.status.economy.science",

  // --- facilities/contracts/strategies/tech
  // mapped on the wire now that CareerViewProvider carries the fields each widget's
  // parser needs (see the TELEMACHUS_KNOWN_GAPS entries these five keys
  // used to live under, just below, for the full before/after shape
  // rationale). Each target field-path is a raw walk off `career.status`
  // (TimelineStore.resolveRawFieldSubtopic) — `facilities`/`contracts.
  // active`/`contracts.offered`/`strategies.all`/`tech.nodes` are exactly
  // the sub-trees CareerViewProvider.BuildCareer's doc comment documents. ---
  "kc.facilityLevels": "career.status.facilities",
  "contracts.active": "career.status.contracts.active",
  "contracts.offered": "career.status.contracts.offered",
  "strategies.all": "career.status.strategies.all",
  "tech.nodes": "career.status.tech.nodes",

  // --- science.experiments mapping. ScienceCapture's
  // `science.experiments` (mod/Sitrep.Host/ScienceViewProvider.cs) is a raw
  // array whose entries are a strict SUPERSET of the legacy `sci.experiments`
  // shape — `partName` replaces `part` (same string, renamed field;
  // `parseExperiments` in ScienceBench/index.tsx reads `partName ?? part` so
  // both wire shapes parse identically), plus new fields
  // (location/experimentId/scienceValueRatio/baseTransmitValue/
  // transmitBonus/labValue/deployed/inoperable/situation) the widget doesn't
  // read. `sci.count`/`sci.dataAmount` stay gapped below — no equivalent
  // aggregate field exists on the new wire (they ARE derivable client-side
  // from this same array, but the widget's existing two separate reads are
  // left untouched here).
  "sci.experiments": "science.experiments",
  // sci.experimentBreakdown: the per-subject rollup (biome/situation/
  // remainingPotential) now has a real wire home — ScienceViewProvider's
  // ExperimentBreakdownEntry[], the same field names (subjectId/biome/
  // situation/expTitle/dataMits/remainingPotential) ScienceBench's
  // parseExperimentBreakdown already reads, whole-array identity read.
  "sci.experimentBreakdown": "science.experimentBreakdown",

  // --- science/parts topics: NEW capability, no legacy widget key existed
  // for either — `parts.power` (dict: solarPanels/batteries/fuelCells/
  // alternators/totalProductionEc, mod/Sitrep.Host/PartsViewProvider.cs) and
  // `parts.robotics` (raw array of hinge+piston+rotor servo state) are both
  // 2-segment raw wire topics read WHOLESALE (same "no legacy analogue, key
  // == topic" shape as `tar.relativePosition` etc. above) rather than a
  // `<domain>.<channel>.<field>` walk — matches `system.vessels`'s own
  // whole-topic mapping precedent. PowerSystems reads `parts.power` as a
  // MIXED-source enrichment (preferring `totalProductionEc` over its
  // topology-summed total when carried, `??` falls back otherwise — same
  // pattern as DistanceToTarget's Vec3 merges). RoboticsConsole/
  // RotorTachometer read `parts.robotics` (filtered by `type`) as their
  // WHOLE identity list — partId-keyed selection and every `robotics.*`
  // command key off the stable stringified `partId` each entry carries.
  "parts.power": "parts.power",
  "parts.robotics": "parts.robotics",

  // --- science.lab mapping. NEW capability, no
  // legacy widget key existed — `science.lab` (raw array of Mobile
  // Processing Lab entries, ScienceViewProvider.BuildLab) has no
  // pre-existing `sci.*` analogue at all (`sci.instruments` below tracks a
  // DIFFERENT set of parts — crew-report/mystery-goo/barometer experiment
  // modules — not the lab itself), so this is a whole-topic identity read,
  // same `parts.power`/`parts.robotics` "key == topic" precedent above.
  // ScienceOfficer/index.tsx's `parseLab` reads it directly. ---
  "science.lab": "science.lab",

  // --- DeployedScience mapping. `science.deployed`
  // (raw FLAT array of individual `ModuleGroundExperiment` entries — no
  // legacy base/power-balance grouping — ScienceViewProvider.BuildDeployed,
  // itself fed by Gonogo.KSP.KspHost.BuildDeployedScience's GLOBAL
  // FlightGlobals.Vessels walk, see that method's doc comment) is routed
  // onto the SAME widget-facing key `deployed.bases` used to point at,
  // same "one parser accepts either wire shape" pattern `science.experiments`
  // established above. DeployedScience/index.tsx's `parseBases` now detects
  // the shape (legacy: numeric `id`; new: string `vesselName`, no `id`) and,
  // for the new shape, groups the flat list by `vesselName` into the
  // existing `DeployedBase[]` display type
  // (`groupFlatDeployedEntries`) — vesselName groups 1:1 with a Breaking
  // Ground cluster, itself its own vessel. `powerAvailable`/`powerRequired`
  // (no EC numbers on the new wire, only a coarse `powerState` enum) degrade
  // to `0`/`0`, same "no new-wire equivalent, degrade" posture the
  // `currentLevelText`/`nextLevelText` career-detail fields established.
  // `deployed.available` stays gapped below — see that entry for why. ---
  "deployed.bases": "science.deployed",

  // --- career.mode + science.sensors. ---

  // career.mode: CareerMode is its own 2-segment raw wire topic
  // ({ mode: GameMode }, CareerViewProvider) — a raw-field walk to the
  // single `mode` field (the numeric GameMode ordinal: Sandbox 0/Career
  // 1/Science 2/Unknown 3). useGameContext resolves the ordinal to the
  // SANDBOX/CAREER/SCIENCE/Unknown string ScienceBench and useGameContext's
  // own callers already read (see useGameContext.ts's resolveCareerMode).
  "career.mode": "career.mode.mode",

  // science.sensors: NEW capability, no legacy per-type `s.sensor.
  // <type>` equivalent (those four stay individually gapped below — no
  // per-type field exists on the wire, only this general SensorEntry[]
  // list). Whole-topic identity read, same "key == topic" precedent as
  // parts.power/parts.robotics/science.lab above — ScienceBench filters the
  // array by `type` client-side (WIRE_SENSOR_TYPE in ScienceBench/index.tsx)
  // rather than the mod re-shaping it into four fixed fields.
  "science.sensors": "science.sensors",

  // --- Remaining trivial raw-field walks + whole-topic
  // reads, now that each topic actually ships on the wire. Each of the
  // 2-segment raw topics below (game.dlc / robotics.available /
  // ksp.revertAvailability / spaceCenter.scene / dv.stages / dv.summary /
  // science.instruments) is also newly added to
  // DEFAULT_SITREP_CARRIED_TOPICS (SitrepTelemetryProvider.tsx) — career.status
  // was already carried. ---

  // deployed.available: the state map's old "no DLC-presence boolean"
  // rationale was stale — GameDlc.breakingGround IS that boolean
  // (CareerViewProvider / a plain DLC-presence check), independent of
  // whether any science.deployed cluster exists. DeployedScience reads it
  // as a plain capability flag.
  "deployed.available": "game.dlc.breakingGround",

  // robotics.available: RoboticsConsole/RotorTachometer's own
  // "any deployable part present" capability flag — separate from the
  // identity list itself (`parts.robotics` above).
  "robotics.available": "robotics.available.available",

  // ksp.canRevertToEditor / ksp.canRevertToLaunch: LaunchDirector's revert
  // affordance flags — a dedicated RevertAvailability topic now ships them.
  "ksp.canRevertToEditor": "ksp.revertAvailability.canRevertToEditor",
  "ksp.canRevertToLaunch": "ksp.revertAvailability.canRevertToLaunch",

  // kc.scene: SpaceCenterStatus's current-scene read — its own 2-segment
  // raw topic (SpaceCenterScene.scene), a plain enum-name string on the
  // wire already, no display-map derivation needed.
  "kc.scene": "spaceCenter.scene.scene",

  // kc.crewRoster/kc.savedShips: StaffRoster/LaunchDirector's whole-topic
  // identity reads — SpaceCenterUplink's dedicated crewRoster/savedShips
  // channels are bare arrays, same "key == topic" shape as parts.robotics/
  // science.lab above. Each widget's existing parser already accepts the
  // exact fields the mod ships (name/trait/experienceLevel/available/
  // unavailableReason for crew; name/partCount/totalMass/facility/
  // requiresFunds/missingParts for saved ships).
  "kc.crewRoster": "spaceCenter.crewRoster",
  "kc.savedShips": "spaceCenter.savedShips",

  // kc.partsAvailable: SpaceCenterStatus's "parts unlocked" count — a
  // wrapper object ({ count }) since a bare scalar has no Topic shape of
  // its own, so this is a 1-field raw-field walk like robotics.available
  // above.
  "kc.partsAvailable": "spaceCenter.partsAvailable.count",

  // kc.launchSites: LaunchDirector's launch-site picker roster — the
  // SpaceCenterUplink's dedicated launchSites channel, a bare array, same
  // "key == topic" whole-topic shape as kc.crewRoster/kc.savedShips above.
  // parseLaunchSites accepts BOTH the legacy shape and the new LaunchSiteEntry
  // (editorFacility/isStock in place of facility/ready/unlocked — see that
  // parser).
  "kc.launchSites": "spaceCenter.launchSites",

  // kc.launchSite: LaunchDirector/SpaceCenterStatus's active-site readout —
  // SpaceCenterScene now carries the editor-selected launch site
  // (EditorLogic.launchSiteName) as its own raw field, a plain raw-field walk
  // like kc.scene above.
  "kc.launchSite": "spaceCenter.scene.launchSite",

  // kc.padOccupied/kc.padVesselTitle: the stock-pad occupancy pair, derived on
  // the spaceCenter.state channel (space-center-state.ts) off the stock-pad
  // entry of spaceCenter.launchSites — the mod already carries per-site
  // occupancy there, so these are client-derived rather than a duplicated mod
  // channel. Consumed by LaunchDirector, SpaceCenterStatus and useGameContext.
  "kc.padOccupied": "spaceCenter.state.padOccupied",
  "kc.padVesselTitle": "spaceCenter.state.padVesselTitle",

  // crash.hasRecent/crash.lastCrash: the single-slot "last notable crash"
  // event (CrashUplink, ReliableOrdered) — LaunchDirector's revert-recovery
  // gate and FlightOutcomeBanner's outcome parse both read these directly.
  // Whole-topic identity reads, same "key == topic" shape as parts.robotics/
  // science.lab above.
  "crash.hasRecent": "crash.hasRecent",
  "crash.lastCrash": "crash.lastCrash",

  // recovery.hasRecent/recovery.lastSummary: the single-slot "last notable
  // recovery" event (RecoveryUplink, ReliableOrdered) — FlightOutcomeBanner's
  // outcome parse reads these directly, the recovery-side counterpart of
  // crash.hasRecent/crash.lastCrash immediately above. Whole-topic identity
  // reads, same "key == topic" shape. Built as the pre-deletion recovery.*
  // topic (P4c-b §2) — was never gapped (no TELEMACHUS_KNOWN_GAPS entry
  // either) because nobody had wired a mapping OR a gap for it before now.
  "recovery.hasRecent": "recovery.hasRecent",
  "recovery.lastSummary": "recovery.lastSummary",

  // contracts.completedRecent: the state map's old "no wire equivalent"
  // rationale was stale — CareerContracts now carries a completedRecent
  // list alongside active/offered.
  "contracts.completedRecent": "career.status.contracts.completedRecent",

  // sci.instruments: ScienceOfficer's per-instrument list (crew report/
  // mystery goo/barometer etc, keyed by partId) now has a real wire home —
  // a DIFFERENT array to science.lab (the Mobile Processing Lab), whole-topic
  // identity read same as parts.power/parts.robotics/science.lab above.
  "sci.instruments": "science.instruments",

  // dv.stages: FuelStatus/stage-sim's per-stage delta-v breakdown, whole
  // array read straight off the new StageDeltaVEntry[] topic.
  "dv.stages": "dv.stages",

  // dv.stageCount/totalDVVac/totalDVASL/totalDVActual/totalBurnTime: the
  // vessel-level aggregate scalars, all on the sibling StageDeltaVSummary
  // topic (dv.summary), each a raw-field walk.
  "dv.stageCount": "dv.summary.stageCount",
  "dv.totalDVVac": "dv.summary.totalDvVac",
  "dv.totalDVASL": "dv.summary.totalDvAsl",
  "dv.totalDVActual": "dv.summary.totalDvActual",
  "dv.totalBurnTime": "dv.summary.totalBurnTime",

  // dv.total/dv.current/dv.currentFuelMass/dv.totalMass: the four
  // Graph-picker scalars `@ksp-gonogo/data`'s old `registerBuiltinDerivedKeys()`
  // projected out of `dv.stages` client-side — never had a stream home at
  // all until now (they were 100% legacy-only, unlike `dv.currentTWR`
  // above). `dv-legacy-scalars.ts`'s `dvLegacyScalarsChannel` recomputes the
  // exact same rollups off the same two already-carried raw topics
  // (`dv.stages` + `vessel.structure.currentStage`) as `fields: true`
  // subtopics — same "new derived channel, static field-subtopic mapping"
  // shape as `vessel.state.twr` itself.
  "dv.total": "dv.legacyScalars.total",
  "dv.current": "dv.legacyScalars.current",
  "dv.currentFuelMass": "dv.legacyScalars.currentFuelMass",
  "dv.totalMass": "dv.legacyScalars.totalMass",

  // scansat.available/scansat.scanningVessels: GonogoScansatUplink publishes
  // both under the exact same topic names the client already reads (see
  // ScansatUplink.cs's AvailableTopic/ScanningVesselsTopic consts) — a
  // whole-topic identity read, same "key == topic" shape as parts.robotics/
  // science.lab above. Was stuck in TELEMACHUS_KNOWN_GAPS even though the
  // Uplink shipped the data; useScanSatFogSync/useScanLayers/MapView/Scanning
  // now resolve it off the stream instead of going silently inert.
  "scansat.available": "scansat.available",
  "scansat.scanningVessels": "scansat.scanningVessels",
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
 * (current-STAGE totals) resolve through the `dv.currentStageResource(Max)`
 * DERIVED channels (`dv-stage-resources.ts`) instead of a static raw-field
 * path: `dv.stages` carries a per-STAGE resource breakdown
 * (`Gonogo.KSP.KspHost.BuildStageResources`), but "the currently active
 * stage" is a dynamic lookup keyed off `vessel.structure.currentStage` — no
 * static field-path string can express that, so a real `derive()` picks out
 * the matching array entry and republishes it as a flat resource-name-keyed
 * map. See `RESOURCE_STAGE_SCOPED`'s resolution below.
 *
 * The generated target has an extra `.resources` segment
 * (`vessel.resources.resources.<name>.<current|max>`, not the flatter
 * `vessel.resources.<name>.<current|max>` you'd expect) — found + fixed in
 * the FuelStatus migration. `VesselViewProvider.ToWire`
 * (`mod/Sitrep.Host/VesselViewProvider.cs`) serializes `VesselResources` as
 * `{ resources: { <name>: {current, max} }, meta: {...} }`, wrapping the
 * per-resource map under a `"resources"` KEY rather than publishing it at
 * the record root. `TimelineStore.resolveRawFieldSubtopic`
 * (`timeline-store.ts`) mechanically splits any 3+-segment target into a
 * 2-segment `rawTopic` (here, `"vessel.resources"`) plus a fieldPath walked
 * verbatim off that record's payload — so the fieldPath itself must include
 * the wrapper key. This channel was never in the 6-topic
 * `reference-wire-fixture.json` set, so the "every currently shipped
 * raw-field entry has been checked against the real wire fixture" guarantee
 * (`sampleRawFieldSubtopic`'s own doc comment) never actually covered it —
 * the flat form would have silently resolved to a permanent `undefined`
 * once a widget migrated onto it and the mod deployed for real, with no
 * fallback to legacy (`isUnresolvableField`'s phantom-mapping guard is NOT
 * extended to the raw-field path either — see `sampleRawFieldSubtopic`'s
 * doc comment). */
const RESOURCE_VESSEL_TOTAL = /^r\.resource(Max)?\[([^\]]+)\]$/;
const RESOURCE_STAGE_SCOPED = /^r\.resourceCurrent(Max)?\[([^\]]+)\]$/;

/**
 * Old keys with NO new home yet, covering every gapped key actually found
 * in widget `dataRequirements`/`useDataValue` call sites. Exported so
 * `@ksp-gonogo/core`'s coverage test can assert "mapped OR declared gap"
 * without a silent third case.
 */
export const TELEMACHUS_KNOWN_GAPS: ReadonlySet<string> = new Set([
  // --- The phantom vessel.state.* mapTopic targets
  // (met/apoapsisAlt/periapsisAlt/period/timeToAp/timeToPe/trueAnomaly) are
  // mapped on the wire now that deriveVesselState actually
  // produces all seven (vessel-state.ts, reading vessel.orbit's elements
  // plus vessel.identity/system.bodies), so they moved up to
  // TELEMACHUS_CLEAN_HOMES above. vessel-state-mapping.coverage.test.ts
  // keeps enforcing "every vessel.state.* mapTopic target is a real produced
  // field" so this class of dead-mapping bug can't silently recur.

  // --- Shape-mismatch gaps: each of these
  // was previously in TELEMACHUS_CLEAN_HOMES pointing at a new topic whose
  // VALUE SHAPE does not match what the widget reads — a migrated widget
  // would have silently rendered garbage (or thrown) instead of falling
  // back to the working legacy DataSource path. Moved here so the fallback
  // fires until the real fix (a derived display-map/field subtopic, or a
  // server-side field the contract doesn't have yet) lands.

  // v.body / o.referenceBody are mapped on the wire: the
  // index→name display-map subtopic now exists — deriveVesselState resolves
  // vessel.identity.parentBodyIndex / vessel.orbit.referenceBodyIndex against
  // system.bodies into vessel.state.parentBodyName / referenceBodyName. See
  // TELEMACHUS_CLEAN_HOMES above.

  // b.number is mapped on the wire: the plain body COUNT the widget
  // reads is now derived on the SYSTEM-scoped `system.state.bodyCount`
  // channel (system-state.ts, `bodies.length`) — see TELEMACHUS_CLEAN_HOMES.

  // o.encounterExists/o.encounterBody/o.encounterTime are mapped on the
  // wire: the single nullable `vessel.orbit.encounter` record now feeds
  // three derived `vessel.state.*` fields shaped exactly as OrbitalEventChips
  // reads them — signed -1/0/1 exists (keyed off TransitionType), the body
  // NAME (bodyIndex→system.bodies), and transitionUt. See
  // TELEMACHUS_CLEAN_HOMES above.

  // dock.x/dock.y are mapped on the wire: NOT alignment axes after all
  // — the widget renders them as metres and already uses
  // vessel.dock.relativePosition.{x,y} as their verbatim drop-in replacement.
  // Mapped straight through the raw-field-subtopic walk into that Vec3 (no
  // derived field). See TELEMACHUS_CLEAN_HOMES above.

  // comm.controlState/comm.controlStateName are mapped on the wire: the mod
  // field `vessel.comms.controlState` is a NUMERIC
  // `Sitrep.Contract.ControlState` enum ordinal on the wire (`(int)comms.
  // ControlState` — despite this comment's former "STRING enum" wording, the
  // host serializes the integer). `deriveVesselState` now resolves it BOTH
  // ways: the ordinal → enum name string (`vessel.state.commsControlStateName`,
  // the old `comm.controlStateName`) AND → CommSignal's Telemachus 0/1/2
  // control-level (`vessel.state.commsControlStateOrdinal`, the old numeric
  // `comm.controlState`). See TELEMACHUS_CLEAN_HOMES above.

  // --- Fixture-audit finds: the grown 15-channel reference wire
  // fixture (WireFixtureGeneratorTests.cs) put real vessel.identity/
  // vessel.control/vessel.target payloads in front of these three mappings
  // for the first time — each RESOLVES (the field path is real) but carries
  // the WRONG SHAPE for what the widget reads, the same class of bug as the
  // findings above, just one level deeper than the raw-path
  // check `map-topic.rawFieldRoots.coverage.test.ts` already runs. ---

  // v.situationString / f.sasMode / tar.type are mapped on the wire: each
  // mod field (vessel.identity.situation /
  // vessel.control.sasMode / vessel.target.kind) is a NUMERIC contract-enum
  // ordinal on the wire; `deriveVesselState` resolves each to the STRING the
  // widget reads — `vessel.state.situationName` / `sasModeName` / `targetKind`
  // (`tar.type`'s `Body` normalized to the legacy "CelestialBody" string
  // DistanceToTarget's dockable gate compares against). See
  // TELEMACHUS_CLEAN_HOMES above.

  // tar.o.relativeVelocity is mapped on the wire: the signed scalar
  // closing-speed is now derived on `vessel.state.targetRelativeSpeed` — the
  // range-rate dot(relPos,relVel)/|relPos| off vessel.target's two Vec3
  // fields, positive=opening / <0=closing as the widgets expect. See
  // TELEMACHUS_CLEAN_HOMES above.

  // o.maneuverNodes is mapped on the wire — see TELEMACHUS_CLEAN_HOMES
  // above (`vessel.maneuver.legacy.nodes`, `maneuver-legacy.ts`).

  // dv.currentTWR is mapped on the wire: `VesselPropulsion`
  // ships CurrentThrust + TotalMass, so TWR = currentThrust/(totalMass·g) is
  // derived client-side on `vessel.state.twr` (vessel-state.ts, standard
  // gravity 9.80665). See TELEMACHUS_CLEAN_HOMES above.

  // comm.signalDelay is mapped on the wire: the old rationale
  // ("aspirational, no implementation") is STALE — comms.delay is live on the
  // wire (CommsCoreUplink, TrueNow) as { oneWaySeconds, source, meta } and is
  // gonogo's OWN SignalDelay authority. CommSignal reads a plain seconds
  // number, so comm.signalDelay -> comms.delay.oneWaySeconds (raw-field walk).
  // See TELEMACHUS_CLEAN_HOMES above.

  // --- ActionGroup's dynamically-resolved keys
  // (see mapTopic.coverage.test.ts's collectDynamicTelemachusKeys). Of the
  // 17 keys, sas/rcs/gear/brake/light have clean 1:1 boolean homes above;
  // the rest don't exist as individual fields on VesselControl
  // (mod/Sitrep.Contract/VesselControl.cs) yet ---

  // v.abortValue is mapped on the wire: VesselControl now carries a
  // plain `Abort` field (`vessel.control.abort`, camelCase on the wire) —
  // see TELEMACHUS_CLEAN_HOMES above.

  // v.ag1Value..v.ag10Value are mapped on the wire: the
  // fixed-order `VesselControl.actionGroups` bool[] is now split into ten
  // per-index `vessel.state.actionGroup{n}` booleans each ActionGroup widget
  // instance reads as its own bool (plus a dynamic `vessel.state.actionGroups`
  // keyed map for Action Groups Extended's variable count). See
  // TELEMACHUS_CLEAN_HOMES above. (The ActionGroup widget stays hybrid only
  // on precision — `v.precisionControlValue` below.)

  // v.precisionControlValue is mapped on the wire: VesselControl
  // now carries a `precisionControl` field — see TELEMACHUS_CLEAN_HOMES
  // above (shared with f.precisionControl).

  // land.predictedLat/Lon are mapped on the wire — see TELEMACHUS_CLEAN_HOMES
  // above (client patch-walk, `vessel.state.landingPredicted{Lat,Lon}`).
  // (The four ballistic SCALARS — timeToImpact/speedAtImpact/
  // bestSpeedAtImpact/suicideBurnCountdown — are ALSO client-derived on
  // vessel.state.landing* off vessel.flight + vessel.orbit.mu + the
  // system.bodies radius + vessel.propulsion; see TELEMACHUS_CLEAN_HOMES.)
  //
  // land.slopeAngle stays gapped: it needs the terrain HEIGHTMAP around the
  // predicted point (KSP's PQS), not just the impact coordinate itself — no
  // mod-side terrain asset exists yet, and the client's only candidate
  // terrain source (SCANsat's `scan.heightGrid`, `@ksp-gonogo/data`'s
  // `useScanHeightGrid`) is coverage-gated (only where a scanner has
  // actually passed over) and too coarse (1°×1° tiles) for a local slope
  // estimate at a single point — a separately-scoped follow-up, not folded
  // in here.
  "land.slopeAngle",

  // o.orbitPatches is mapped on the wire — see TELEMACHUS_CLEAN_HOMES above
  // (`vessel.state.orbitPatches`, the mod's full patched-conic chain).

  // v.atmosphericTemperature / v.externalTemperature are mapped on the
  // wire — see TELEMACHUS_CLEAN_HOMES above.

  // --- thermal detail beyond headline ratios. heatShieldTempCelsius/
  // heatShieldFlux, therm.hottestPartName (ThermalHottestPart.Name), and
  // the engine-scoped hottestEngineTemp/MaxTemp/TempRatio/
  // anyEnginesOverheating quartet are all mapped on the wire now —
  // VesselThermal carries every one of them, see TELEMACHUS_CLEAN_HOMES
  // above. ---

  // v.crew / v.crewCapacity are mapped on the wire — see
  // TELEMACHUS_CLEAN_HOMES above.

  // v.biome / v.landedAt are mapped on the wire: vessel.surface now ships
  // Biome + LandedAt — see TELEMACHUS_CLEAN_HOMES above.

  // dv.stageCount/dv.stages/dv.totalDVVac/dv.totalDVASL/dv.totalDVActual/
  // dv.totalBurnTime are mapped on the wire — see
  // TELEMACHUS_CLEAN_HOMES above (dv.stages whole-topic + dv.summary.*
  // raw-field walks).

  // v.topology / v.topologySeq are no longer read at all: the structural
  // part-tree data they carried is on the wire as `vessel.parts`
  // (VesselParts — a SIBLING channel of vessel.structure), and
  // `@ksp-gonogo/data`'s `useTopology` reads it directly via the canonical
  // `useTelemetry("vessel.parts")` (bypassing this shim entirely, the same
  // pattern `useVesselDeltaV`/other `@ksp-gonogo/data` hooks use for a
  // stream-native read), reshaping it into the legacy `VesselTopology` shape
  // client-side (`vesselPartsAdapter.ts`). ShipMap/PowerSystems no longer
  // declare either key in `dataRequirements`.

  // robotics.available: a dedicated capability topic ships — see
  // TELEMACHUS_CLEAN_HOMES above. robotics.rotors/robotics.servos are gone
  // from this set entirely: RotorTachometer/RoboticsConsole now build their
  // identity list (partId-keyed selection + every robotics.* command)
  // straight off `parts.robotics` (CLEAN_HOMES above), which carries a
  // stable stringified `partId` per entry.

  // v.isControllable is mapped on the wire: derived from
  // vessel.comms.controlState's control LEVEL on vessel.state.isControllable
  // (see TELEMACHUS_CLEAN_HOMES above). f.precisionControl is mapped on the
  // wire alongside v.precisionControlValue — see
  // TELEMACHUS_CLEAN_HOMES above.

  // --- derived quantities with no named field on the wire yet ---
  // The cleanly-derivable members of this
  // cluster (o.ApR/o.PeR/o.radius/o.nextApsisType/o.timeToNextApsis/
  // v.horizontalVelocity/tar.distance/tar.o.PeA/tar.o.period/
  // tar.o.trueAnomaly) are mapped on the wire — all now derived on
  // vessel.state.* (see TELEMACHUS_CLEAN_HOMES above). The keys BELOW are
  // what genuinely can't be honestly derived from the current wire:

  // v.isEVA / v.splashed are mapped on the wire: derived
  // client-side as plain booleans on `vessel.state.isEVA` (vessel.identity
  // vesselType === EVA) / `vessel.state.isSplashed` (vessel.identity situation
  // === Splashed). See TELEMACHUS_CLEAN_HOMES above.

  // v.angleToPrograde: the angle between vessel facing and the prograde
  // velocity direction. `vessel.attitude` carries only Euler heading/pitch/
  // roll relative to the SURFACE frame — no raw facing unit vector — and
  // "prograde" is itself frame-ambiguous (surface vs orbital). Reconstructing
  // a facing vector from Euler angles and dotting it against a chosen prograde
  // direction is neither cleanly nor unambiguously derivable from what's on
  // the wire (and the one widget that lists it, Navball, doesn't even read it
  // — dead requirement).
  // gap: needs a facing vector + a defined prograde frame, neither on the wire
  "v.angleToPrograde",

  // o.closestTgtApprUT is mapped on the wire: the two-body
  // closest-approach solve over vessel.orbit + vessel.target.orbit now runs
  // client-side (propagation.ts's `closestApproach`), exposed on
  // `vessel.state.closestApproachUt`. See TELEMACHUS_CLEAN_HOMES above.

  // dock.ax/dock.ay/dock.az: the true docking-port ORIENTATION misalignment
  // axes aren't on the wire (vessel.dock carries only RelativePosition/
  // RelativeVelocity/Distance + a scalar ForwardDot). The deliberate decision
  // is to DROP them in favour of the LINE-OF-SIGHT HUD proxy — the shared
  // `deriveDockAngles` helper (packages/components/src/shared/dockAngles.ts)
  // computes ax/ay off dock.relativePosition. They stay gapped here
  // until DistanceToTarget removes the legacy reads +
  // reworks the fixtures/snapshots/visual baselines.
  "dock.ax",
  "dock.ay",
  "dock.az",

  // n.heading2/pitch2/roll2 are mapped on the wire: the
  // genuinely distinct root-part-referenced frame now has a real named field
  // on VesselAttitude — see TELEMACHUS_CLEAN_HOMES above.

  // a.physicsMode is neither mapped nor gapped: the Principia mod-seam
  // revert deleted the ManeuverPlanner/MapView reads entirely (physics-mode
  // N-body detection belongs to a future Principia Uplink, not core), so
  // this key has no consumer left to map or gap. `vessel.physics.mode`'s
  // `Mode` field (OnRails/Packed/Unpacked, genuine stock KSP data) is
  // unaffected and still ships on the wire for a future consumer.

  // --- not a stream at all: sdk.view.ut() / meta.validAt ---
  "t.universalTime",

  // --- out of vessel-provider scope by design — separate provider families ---
  // career.mode is mapped on the wire: CareerMode is
  // its own raw wire topic ({ mode: GameMode }) — a plain raw-field walk to
  // career.mode.mode (the numeric GameMode ordinal). useGameContext resolves
  // the ordinal to the SANDBOX/CAREER/SCIENCE/Unknown string the widgets
  // read (no vessel.state field needed — see TELEMACHUS_CLEAN_HOMES above).
  // kc.crewRoster/kc.savedShips/kc.partsAvailable are mapped on the wire:
  // SpaceCenterUplink now ships spaceCenter.crewRoster/spaceCenter.savedShips/
  // spaceCenter.partsAvailable — see TELEMACHUS_CLEAN_HOMES above.
  // kc.facilityLevels is mapped on the wire — see CLEAN_HOMES
  // above (career.status.facilities, SpaceCenterStatus's parseFacilityLevels
  // now reads BOTH the legacy short-code shape and the new enum-keyed
  // currentTier/maxTier/upgradeCost shape).
  // kc.launchSite/kc.launchSites/kc.padOccupied/kc.padVesselTitle are mapped
  // on the wire: spaceCenter.launchSites carries the roster + per-site
  // occupancy, SpaceCenterScene carries the editor-selected launchSite, and the
  // spaceCenter.state derived channel exposes the stock-pad occupancy pair —
  // see TELEMACHUS_CLEAN_HOMES above.
  // kc.scene is mapped on the wire: SpaceCenterScene now ships
  // its own raw topic — see TELEMACHUS_CLEAN_HOMES above.

  // --- facilities/contracts/strategies/tech
  // are mapped on the wire. A later capture-extend pass widened
  // CareerViewProvider's facilities/contracts/strategies/tech groups from a
  // minimal "just enough to prove the channel exists" shape to what these
  // five widgets actually need — integer
  // currentTier/maxTier/upgradeCost per facility, a stable string `id` +
  // `parameters` per contract, a stable `id` + full cost/eligibility set
  // per strategy (plus the `all` roster, not just `active`), and
  // `id`/`title`/`scienceCost`/`unlocked`/`parents` per tech node. See
  // CLEAN_HOMES above for the five new mappings and each widget's own
  // parser (ContractManager's `parseContracts`, Strategies's
  // `parseStrategies`, TechTree's `parseTechNodes`, SpaceCenterStatus's
  // `parseFacilityLevels`) for how each now accepts BOTH the legacy shape
  // and this new one. `contracts.completedRecent` is mapped on the wire too
  // — CareerContracts now carries a completedRecent list
  // too, see TELEMACHUS_CLEAN_HOMES above. `strategies.all`'s
  // `effectiveCostReputation` also stays
  // client-side-only — deliberately not added to the wire (no cheap
  // decompiled source for KSP's nonlinear rep curve) — `parseStrategies`
  // already falls back to
  // `initialCostReputation` when it's absent, unchanged here.
  // Commands (facility upgrade, contract accept/decline/cancel, strategy
  // activate/deactivate, tech unlock) have no command home yet
  // (KNOWN_COMMAND_GAPS in map-command.ts) and fall back to the legacy
  // DataSource automatically — reads only are mapped here.

  // contracts.completedRecent is mapped on the wire: see
  // TELEMACHUS_CLEAN_HOMES above.

  // sci.count/sci.dataAmount are no longer read by any widget:
  // ScienceBench derives both client-side from the (already-migrated)
  // `science.experiments` array (`sciCount`/`sciDataAmount` in its own
  // `index.tsx`) instead of two separate pre-aggregated reads, so no
  // aggregate-field gap remains.
  // sci.experimentBreakdown is mapped on the wire: a per-subject
  // rollup now ships as its own topic — see TELEMACHUS_CLEAN_HOMES above.
  // sci.instruments is mapped on the wire: a per-instrument list
  // now ships as its own topic — see TELEMACHUS_CLEAN_HOMES above. It is a
  // DIFFERENT array from science.lab (the Mobile Processing Lab).
  // s.sensor.temp/pres/grav/acc are no longer read by any widget: ScienceBench
  // now derives every per-type reading by filtering the whole science.sensors
  // list (CLEAN_HOMES above) client-side, so no per-type gap remains.
  // deployed.bases is mapped on the wire — see CLEAN_HOMES
  // above (science.deployed, DeployedScience's parseBases now reads BOTH
  // the legacy grouped-base shape and the new flat-per-experiment shape).
  // deployed.available is mapped on the wire: the old "can't
  // disambiguate no-DLC from empty-deployed" rationale was stale —
  // GameDlc.breakingGround is its own independent capability boolean, not
  // derived from science.deployed's emptiness. See TELEMACHUS_CLEAN_HOMES
  // above.
  // scansat.available/scansat.scanningVessels are mapped on the wire — see
  // TELEMACHUS_CLEAN_HOMES above. scansat.anomalies.<body> is resolved too,
  // via the SCANSAT_DYNAMIC regex family below (mod's known gap 3 closed) —
  // it was never a TELEMACHUS_KNOWN_GAPS Set member (only mentioned in this
  // comment), so there is nothing to remove from the Set itself.
  // ksp.canRevertToEditor / ksp.canRevertToLaunch are mapped on the wire:
  // a dedicated RevertAvailability topic now ships both flags — see
  // TELEMACHUS_CLEAN_HOMES above.
]);

/**
 * Resolve a widget-facing `(dataSourceId, key)` pair — as passed to
 * `useDataValue` today — to the new SDK stream topic it should read from.
 *
 * Returns `undefined` when there is no mapping: either `dataSourceId` isn't
 * the Telemachus `"data"` source (nothing else is wired to the new SDK yet),
 * or `key` is a known, explicitly-tracked gap (`TELEMACHUS_KNOWN_GAPS`),
 * or `key` is genuinely unrecognized. In every `undefined` case the
 * `@ksp-gonogo/core` `useDataValue` shim falls back to the legacy `DataSource`
 * path — this function intentionally does NOT identity-fallback (contrast
 * with `redirectKinematicSubtopic` above).
 */
/**
 * `kos.compute.<id>.<field>` — the dynamic centralised-compute namespace.
 * Identity-mapped so a future compute-feed slice reads straight off the
 * stream; `.status` sub-topics and `.dispatchNow`/`.reEnable` command keys
 * are deliberately excluded (status has no producer on this table; commands
 * never route through `useDataValue`).
 */
const KOS_COMPUTE_FIELD = /^kos\.compute\.[\w-]+\.[\w-]+$/;
const KOS_COMPUTE_NON_VALUE =
  /^kos\.compute\.[\w-]+\.(status|dispatchNow|reEnable)$/;

/**
 * `scansat.coverage.<body>.<type>` / `scansat.mask.<body>.<type>` /
 * `scansat.height.<body>` / `scansat.biome.<body>` / `scansat.anomalies.<body>`
 * — the dynamic per-body SCANsat namespaces `ScansatUplink.Sample` publishes
 * (see `mod/GonogoScansatUplink/ScanChannels.cs`'s `CoveragePrefix`/
 * `MaskPrefix`/`HeightPrefix`/`BiomePrefix`/`AnomaliesPrefix` +
 * `BodyTypeSubTopic`/`BodySubTopic`). Identity-mapped, same pattern as
 * `KOS_COMPUTE_FIELD` above: the widget-facing key IS the wire topic.
 *
 * `scansat.anomalies.<body>` joined this family once `ScanAnomalies.Build`
 * landed (P4c-b sign-off item, closing `ScansatUplink.cs`'s known gap 3) —
 * previously excluded/gapped because the mod didn't publish it. Like its
 * height/biome/coverage/mask siblings, resolving here does NOT yet mean it is
 * promoted to the live stream: `DEFAULT_SITREP_CARRIED_TOPICS`
 * (`packages/app/src/telemetry/SitrepTelemetryProvider.tsx`) is a
 * literal-string allowlist and can't enumerate a per-body dynamic key, so
 * every topic in this family stays on the legacy read path until that gate
 * grows a prefix/glob extension (tracked there, not a new gap this addition
 * introduces).
 */
const SCANSAT_DYNAMIC =
  /^scansat\.(coverage|mask)\.\w+\.\d+$|^scansat\.(height|biome|anomalies)\.\w+$/;

export function mapTopic(
  dataSourceId: string,
  key: string,
): string | undefined {
  // kOS native + compute streams (U3 mod). Identity maps: the widget-facing
  // key IS the wire topic. The `@ksp-gonogo/core` shim's carried-channels gate +
  // provider-mounted check still decide whether it actually routes to the
  // stream or falls back to the legacy telnet "kos" DataSource.
  if (dataSourceId === "kos") {
    if (key === "kos.processors") return "kos.processors";
    if (KOS_COMPUTE_NON_VALUE.test(key)) return undefined;
    if (KOS_COMPUTE_FIELD.test(key)) return key;
    return undefined;
  }

  if (dataSourceId !== "data") return undefined;

  const clean = TELEMACHUS_CLEAN_HOMES[key];
  if (clean !== undefined) return clean;

  if (SCANSAT_DYNAMIC.test(key)) return key;

  if (BODY_INDEXED_CLEAN.test(key)) return "system.bodies";
  if (BODY_INDEXED_GAP.test(key)) return undefined;

  const resourceMatch = RESOURCE_VESSEL_TOTAL.exec(key);
  if (resourceMatch) {
    const [, isMax, name] = resourceMatch;
    return `vessel.resources.resources.${name}.${isMax ? "max" : "current"}`;
  }

  // Stage-scoped resources: a `fields: true` subtopic off the
  // dv.currentStageResource(Max) DERIVED channels (dv-stage-resources.ts),
  // not a raw-field path — see the RESOURCE_STAGE_SCOPED doc comment above.
  const stageResourceMatch = RESOURCE_STAGE_SCOPED.exec(key);
  if (stageResourceMatch) {
    const [, isMax, name] = stageResourceMatch;
    return isMax
      ? `dv.currentStageResourceMax.${name}`
      : `dv.currentStageResource.${name}`;
  }

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
  // RESOURCE_STAGE_SCOPED is no longer a gap — mapTopic resolves it via the
  // dv.currentStageResource(Max) derived channels (see mapTopic above).
  return BODY_INDEXED_GAP.test(key);
}
