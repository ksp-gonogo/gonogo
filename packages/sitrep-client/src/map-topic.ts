/**
 * The `mapTopic` compatibility shim's data: old-Telemachus-key → new SDK
 * stream topic (M2 design §6 "the `mapTopic` shim"; source of truth is
 * `m1-provider-taxonomy-design.md` §5's migration map, cross-checked against
 * every widget's real `dataRequirements`/`useDataValue` call in
 * `packages/components/src` — see `map-topic.coverage.test.ts` in
 * `@ksp-gonogo/core`, which enumerates the live widget key set and asserts every
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
 *    `@ksp-gonogo/core` shim depends on — it is NOT an identity fallback, unlike
 *    (1) above; the two functions have deliberately incompatible defaults
 *    because they serve different callers (a shim needs to know when it
 *    can't route; a direct-topic safety net needs to always return
 *    something sane).
 *
 * `sourceId === "data"` (the Telemachus `DataSource`) is the main table.
 * `sourceId === "kos"` is ALSO routed now (U3 kOS slice): the mod publishes
 * native `kos.processors` push telemetry plus the dynamic
 * `kos.compute.<id>.<field>` compute namespace, so those topics DO exist on
 * the wire. `"kerbcast"`/other sources remain deliberately NOT routed — their
 * data still doesn't exist on the new SDK's wire, so mapping them would
 * silently break working functionality (the shim would call `useStream` on a
 * topic nothing ever publishes, forever `undefined`, instead of the real
 * live `DataSource`).
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
export const TELEMACHUS_CLEAN_HOMES: Readonly<Record<string, string>> = {
  // --- vessel.state (derived, quality-picked kinematics — V-12) ---
  "v.altitude": "vessel.state.altitudeAsl",
  "v.orbitalVelocity": "vessel.state.orbitalSpeed",
  "o.orbitalSpeed": "vessel.state.orbitalSpeed",

  // --- vessel.state (M3 vessel-state-extend: derivable orbital fields —
  // un-gapped now that deriveVesselState actually produces them, see
  // vessel-state.ts) ---
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
  // v.atmosphericTemperature / v.externalTemperature UN-GAPPED (P4a
  // shared-map batch, G-11): plain raw fields on VesselFlight, not captured
  // by the original M1 walk.
  "v.atmosphericTemperature": "vessel.flight.atmosphericTemperature",
  "v.externalTemperature": "vessel.flight.externalTemperature",

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

  // --- vessel.identity ---
  "v.name": "vessel.identity.name",

  // --- vessel.state (derived body-NAME display maps — Step-2 migration task
  // 1). The mod's new homes for these are `vessel.identity.parentBodyIndex` /
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
  // `(int)…`); the widgets read the STRING name (or, for `comm.controlState`,
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

  // --- vessel.state (derived, client-side shape-mismatch migration batch 2):
  // three more display maps + one range-rate derivation off already-served
  // channels, same pattern as the enum maps above.
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

  // --- vessel.state (derived, client-side A-tranche migration): the
  // "derived quantities with no named field" cluster that IS cleanly
  // recoverable from data already on the wire. Same display-map/derivation
  // pattern as the batches above, zero per-widget change:
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

  // --- R6 shared-derivations batch: client-side derivations off channels
  // already on the wire, unblocking Wave-2 widget migrations (Twr, Navball,
  // CrewManifest, GroundSurvey, ActionGroup ag1..10, DistanceToTarget). Each
  // is a `vessel.state.*` field `deriveVesselState` now produces (see
  // vessel-state.ts), same display-map pattern as the batches above:
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

  // --- vessel.surface capture-add (M3 R3): biome + landedAt now ship on the
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
  // v.abortValue (P4a command batch): VesselControl.Abort now ships on the
  // wire — see TELEMACHUS_KNOWN_GAPS's matching (removed) entry.
  "v.abortValue": "vessel.control.abort",
  // v.precisionControlValue / f.precisionControl UN-GAPPED (P4a shared-map
  // batch): VesselControl now carries a plain `precisionControl` field
  // alongside `abort` — same raw-field walk as the other vessel.control
  // booleans above. ActionGroup's toggle read AND Navball's precision-mode
  // read both land on the same field.
  "v.precisionControlValue": "vessel.control.precisionControl",
  "f.precisionControl": "vessel.control.precisionControl",

  // --- vessel.structure / vessel.crew ---
  "v.currentStage": "vessel.structure.currentStage",
  "v.crewCount": "vessel.crew.count",
  // v.crew / v.crewCapacity UN-GAPPED (P4a shared-map batch, G-13): the full
  // roster + capacity now ship alongside the plain count above.
  "v.crew": "vessel.crew.crew",
  "v.crewCapacity": "vessel.crew.capacity",

  // --- vessel.thermal ---
  "therm.hottestPartTemp": "vessel.thermal.hottestPart.skinTemp",
  "therm.hottestPartTempRatio": "vessel.thermal.maxInternalTempRatio",
  "therm.hottestPartMaxTemp": "vessel.thermal.hottestPart.skinMaxTemp",

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

  // --- M3 vessel-gap batch: DistanceToTarget/TargetPicker dock+roster
  // migration. These are NEW widget-facing keys (no legacy equivalent —
  // added by the migrating widgets themselves) that expose the raw Vec3
  // fields so the widget can derive a scalar/angle client-side and merge it
  // with the still-legacy read via a `??` fallback — the same
  // MIXED-source-within-one-render pattern CurrentOrbit's M3 batch-2
  // migration established. See DistanceToTarget/index.tsx's
  // `vecMagnitude`/`deriveDockAngles`. Of the legacy keys that pattern backs,
  // `tar.distance`/`tar.o.relativeVelocity`/`dock.x`/`dock.y` have since been
  // UN-GAPPED (they ARE cleanly derivable — see the batch-2 + A-tranche
  // CLEAN_HOMES blocks above); only the docking-ORIENTATION angles
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

  // --- M3 vessel-gap batch: ManeuverPlanner node-id command bridge. NEW
  // widget-facing key (no legacy equivalent) exposing the raw
  // `vessel.maneuver.nodes` array purely so the widget can read each node's
  // now-round-tripping `id` (M3 R3) and pass the real guid into the
  // update/remove commands instead of a positional array index. The
  // full-preview read `o.maneuverNodes` itself STAYS gapped below (shape
  // mismatch: no deltaV tuple, no post-burn orbit preview on the wire) — see
  // ManeuverPlanner/index.tsx's `resolveNodeId`. ---
  "o.maneuverNodeIds": "vessel.maneuver.nodes",

  // --- M3 vessel-gap batch: TargetPicker roster. NEW shape — {vessels:
  // [{vesselId, name, vesselType, situation, bodyIndex}]}, no position/
  // distance field (system.vessels' own doc comment,
  // mod/Sitrep.Host/SystemViewProvider.cs) — TargetPicker normalizes both
  // shapes into a common display type client-side; see index.tsx's
  // `normalizeRoster`. ---
  "tar.availableVessels": "system.vessels",

  // --- M3 career batch: career.status economy scalars. Clean 1:1 raw-field
  // reads — CareerViewProvider.BuildEconomy (mod/Sitrep.Host/
  // CareerViewProvider.cs) republishes Funding/Reputation/R&D science as
  // plain nullable doubles, same shape the widgets already expect. The
  // sibling groups (facilities/contracts/strategies/tech) do NOT get the
  // same clean treatment — see the TELEMACHUS_KNOWN_GAPS entries below for
  // why each one is a real shape mismatch, not an oversight. ---
  "career.funds": "career.status.economy.funds",
  "career.reputation": "career.status.economy.reputation",
  "career.science": "career.status.economy.science",

  // --- M3b career-detail batch: facilities/contracts/strategies/tech
  // un-gapped now that CareerViewProvider carries the fields each widget's
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

  // --- M3 science/parts batch: science.experiments un-gap. ScienceCapture's
  // `science.experiments` (mod/Sitrep.Host/ScienceViewProvider.cs) is a raw
  // array whose entries are a strict SUPERSET of the legacy `sci.experiments`
  // shape — `partName` replaces `part` (same string, renamed field;
  // `parseExperiments` in ScienceBench/index.tsx reads `partName ?? part` so
  // both wire shapes parse identically), plus new fields
  // (location/experimentId/scienceValueRatio/baseTransmitValue/
  // transmitBonus/labValue/deployed/inoperable/situation) the widget doesn't
  // read. `sci.count`/`sci.dataAmount`/`sci.experimentBreakdown` stay gapped
  // below — no equivalent aggregate/enriched field exists on the new wire
  // (count/dataAmount ARE derivable client-side from this same array, but
  // the widget's existing two separate reads are left untouched this batch).
  "sci.experiments": "science.experiments",

  // --- M3 science/parts batch: NEW capability, no legacy widget key existed
  // for either — `parts.power` (dict: solarPanels/batteries/fuelCells/
  // alternators/totalProductionEc, mod/Sitrep.Host/PartsViewProvider.cs) and
  // `parts.robotics` (raw array of hinge+rotor servo state) are both
  // 2-segment raw wire topics read WHOLESALE (same "no legacy analogue, key
  // == topic" shape as `tar.relativePosition` etc. above) rather than a
  // `<domain>.<channel>.<field>` walk — matches `system.vessels`'s own
  // whole-topic mapping precedent. PowerSystems reads `parts.power` as a
  // MIXED-source enrichment (preferring `totalProductionEc` over its
  // topology-summed total when carried, `??` falls back otherwise — same
  // pattern as DistanceToTarget's Vec3 merges). RoboticsConsole/
  // RotorTachometer read `parts.robotics` (filtered by `type`) to merge live
  // numeric readouts (angle/RPM/output/brake) onto the still-legacy
  // `robotics.servos`/`robotics.rotors` identity list (no `partId`/stable id
  // on the new wire — see those two keys' own TELEMACHUS_KNOWN_GAPS entries
  // below, unchanged, for why the full list itself isn't migrated).
  "parts.power": "parts.power",
  "parts.robotics": "parts.robotics",

  // --- M3 ScienceOfficer batch: science.lab un-gap. NEW capability, no
  // legacy widget key existed — `science.lab` (raw array of Mobile
  // Processing Lab entries, ScienceViewProvider.BuildLab) has no
  // pre-existing `sci.*` analogue at all (`sci.instruments` below tracks a
  // DIFFERENT set of parts — crew-report/mystery-goo/barometer experiment
  // modules — not the lab itself), so this is a whole-topic identity read,
  // same `parts.power`/`parts.robotics` "key == topic" precedent above.
  // ScienceOfficer/index.tsx's `parseLab` reads it directly. ---
  "science.lab": "science.lab",

  // --- M3 science-domain finale: DeployedScience un-gap. `science.deployed`
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
  // to `0`/`0`, same "no new-wire equivalent, degrade" posture the M3b
  // career-detail batch's `currentLevelText`/`nextLevelText` established.
  // `deployed.available` stays gapped below — see that entry for why. ---
  "deployed.bases": "science.deployed",

  // --- P4a client-derivations batch: career.mode + science.sensors. ---

  // career.mode (D1): CareerMode is its own 2-segment raw wire topic
  // ({ mode: GameMode }, CareerViewProvider) — a raw-field walk to the
  // single `mode` field (the numeric GameMode ordinal: Sandbox 0/Career
  // 1/Science 2/Unknown 3). useGameContext resolves the ordinal to the
  // SANDBOX/CAREER/SCIENCE/Unknown string ScienceBench and useGameContext's
  // own callers already read (see useGameContext.ts's resolveCareerMode).
  "career.mode": "career.mode.mode",

  // science.sensors (D2): NEW capability, no legacy per-type `s.sensor.
  // <type>` equivalent (those four stay individually gapped below — no
  // per-type field exists on the wire, only this general SensorEntry[]
  // list). Whole-topic identity read, same "key == topic" precedent as
  // parts.power/parts.robotics/science.lab above — ScienceBench filters the
  // array by `type` client-side (WIRE_SENSOR_TYPE in ScienceBench/index.tsx)
  // rather than the mod re-shaping it into four fixed fields.
  "science.sensors": "science.sensors",

  // --- P4a shared-map batch: remaining trivial raw-field walks + whole-topic
  // reads, now that each topic actually ships on the wire. Each of the
  // 2-segment raw topics below (game.dlc / robotics.available /
  // ksp.revertAvailability / spaceCenter.scene / dv.stages / dv.summary /
  // science.instruments) is also newly added to
  // DEFAULT_SITREP_CARRIED_TOPICS (SitrepTelemetryProvider.tsx) — career.status
  // was already carried by the M3b career-detail batch. ---

  // deployed.available: the state map's old "no DLC-presence boolean"
  // rationale was stale — GameDlc.breakingGround IS that boolean
  // (CareerViewProvider / a plain DLC-presence check), independent of
  // whether any science.deployed cluster exists. DeployedScience reads it
  // as a plain capability flag.
  "deployed.available": "game.dlc.breakingGround",

  // robotics.available: RoboticsConsole/RotorTachometer's own
  // "any deployable part present" capability flag — separate from the
  // identity-list gap (robotics.rotors/robotics.servos stay gapped, no
  // stable id on the wire).
  "robotics.available": "robotics.available.available",

  // ksp.canRevertToEditor / ksp.canRevertToLaunch: LaunchDirector's revert
  // affordance flags — a dedicated RevertAvailability topic now ships them.
  "ksp.canRevertToEditor": "ksp.revertAvailability.canRevertToEditor",
  "ksp.canRevertToLaunch": "ksp.revertAvailability.canRevertToLaunch",

  // kc.scene: SpaceCenterStatus's current-scene read — its own 2-segment
  // raw topic (SpaceCenterScene.scene), a plain enum-name string on the
  // wire already, no display-map derivation needed.
  "kc.scene": "spaceCenter.scene.scene",

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
 * gap as `dv.stages`.
 *
 * The generated target has an extra `.resources` segment
 * (`vessel.resources.resources.<name>.<current|max>`, not the flatter
 * `vessel.resources.<name>.<current|max>` you'd expect) — found + fixed in
 * the M3 batch-1 FuelStatus migration. `VesselViewProvider.ToWire`
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
 * Old keys with NO new home yet — the M1 §5.2 gaps table, extended with
 * every gapped key actually found in widget `dataRequirements`/
 * `useDataValue` call sites. Exported so `@ksp-gonogo/core`'s coverage test can
 * assert "mapped OR declared gap" without a silent third case.
 */
export const TELEMACHUS_KNOWN_GAPS: ReadonlySet<string> = new Set([
  // --- M2 bridge task Fix 2's phantom vessel.state.* mapTopic targets
  // (met/apoapsisAlt/periapsisAlt/period/timeToAp/timeToPe/trueAnomaly) are
  // UN-GAPPED as of M3 vessel-state-extend: deriveVesselState now actually
  // produces all seven (vessel-state.ts, reading vessel.orbit's elements
  // plus vessel.identity/system.bodies), so they moved up to
  // TELEMACHUS_CLEAN_HOMES above. vessel-state-mapping.coverage.test.ts
  // keeps enforcing "every vessel.state.* mapTopic target is a real produced
  // field" so this class of dead-mapping bug can't silently recur.

  // --- CRITICAL-review shape-mismatch gaps (M2 Task 7 fix): each of these
  // was previously in TELEMACHUS_CLEAN_HOMES pointing at a new topic whose
  // VALUE SHAPE does not match what the widget reads — a migrated widget
  // would have silently rendered garbage (or thrown) instead of falling
  // back to the working legacy DataSource path. Moved here so the fallback
  // fires until the real fix (a derived display-map/field subtopic, or a
  // server-side field the contract doesn't have yet) lands in M3.

  // v.body / o.referenceBody UN-GAPPED (Step-2 migration task 1): the
  // index→name display-map subtopic now exists — deriveVesselState resolves
  // vessel.identity.parentBodyIndex / vessel.orbit.referenceBodyIndex against
  // system.bodies into vessel.state.parentBodyName / referenceBodyName. See
  // TELEMACHUS_CLEAN_HOMES above.

  // b.number UN-GAPPED (batch-2 migration): the plain body COUNT the widget
  // reads is now derived on the SYSTEM-scoped `system.state.bodyCount`
  // channel (system-state.ts, `bodies.length`) — see TELEMACHUS_CLEAN_HOMES.

  // o.encounterExists/o.encounterBody/o.encounterTime UN-GAPPED (batch-2
  // migration): the single nullable `vessel.orbit.encounter` record now feeds
  // three derived `vessel.state.*` fields shaped exactly as OrbitalEventChips
  // reads them — signed -1/0/1 exists (keyed off TransitionType), the body
  // NAME (bodyIndex→system.bodies), and transitionUt. See
  // TELEMACHUS_CLEAN_HOMES above.

  // dock.x/dock.y UN-GAPPED (batch-2 migration): NOT alignment axes after all
  // — the widget renders them as metres and already uses
  // vessel.dock.relativePosition.{x,y} as their verbatim drop-in replacement.
  // Mapped straight through the raw-field-subtopic walk into that Vec3 (no
  // derived field). See TELEMACHUS_CLEAN_HOMES above.

  // comm.controlState/comm.controlStateName UN-GAPPED (enum-ordinal→name
  // migration task 4): the mod field `vessel.comms.controlState` is a NUMERIC
  // `Sitrep.Contract.ControlState` enum ordinal on the wire (`(int)comms.
  // ControlState` — despite this comment's former "STRING enum" wording, the
  // host serializes the integer). `deriveVesselState` now resolves it BOTH
  // ways: the ordinal → enum name string (`vessel.state.commsControlStateName`,
  // the old `comm.controlStateName`) AND → CommSignal's Telemachus 0/1/2
  // control-level (`vessel.state.commsControlStateOrdinal`, the old numeric
  // `comm.controlState`). See TELEMACHUS_CLEAN_HOMES above.

  // --- M3 batch-2 fixture-audit finds: the grown 15-channel reference wire
  // fixture (WireFixtureGeneratorTests.cs) put real vessel.identity/
  // vessel.control/vessel.target payloads in front of these three mappings
  // for the first time — each RESOLVES (the field path is real) but carries
  // the WRONG SHAPE for what the widget reads, the same class of bug as the
  // CRITICAL-review findings above, just one level deeper than the raw-path
  // check `map-topic.rawFieldRoots.coverage.test.ts` already runs. ---

  // v.situationString / f.sasMode / tar.type UN-GAPPED (enum-ordinal→name
  // migration tasks 1–3): each mod field (vessel.identity.situation /
  // vessel.control.sasMode / vessel.target.kind) is a NUMERIC contract-enum
  // ordinal on the wire; `deriveVesselState` resolves each to the STRING the
  // widget reads — `vessel.state.situationName` / `sasModeName` / `targetKind`
  // (`tar.type`'s `Body` normalized to the legacy "CelestialBody" string
  // DistanceToTarget's dockable gate compares against). See
  // TELEMACHUS_CLEAN_HOMES above.

  // tar.o.relativeVelocity UN-GAPPED (batch-2 migration): the signed scalar
  // closing-speed is now derived on `vessel.state.targetRelativeSpeed` — the
  // range-rate dot(relPos,relVel)/|relPos| off vessel.target's two Vec3
  // fields, positive=opening / <0=closing as the widgets expect. See
  // TELEMACHUS_CLEAN_HOMES above.

  // o.maneuverNodes: ManeuverPlanner/MapView read each node's `deltaV:
  // [x,y,z]` tuple plus a full post-burn orbit preview per node (PeA, ApA,
  // inclination, orbitPatches, referenceBody, ...). The new
  // `vessel.maneuver.nodes` ManeuverNode only carries
  // {ut, dvRadial?, dvNormal?, dvPrograde?, dvTotal?} — no deltaV tuple, no
  // orbit-preview fields at all (the post-burn preview is explicitly
  // documented as consumer-side-derived, not streamed).
  // gap: needs a derived display-map/field subtopic; migrate in M3
  "o.maneuverNodes",

  // dv.currentTWR UN-GAPPED (R6 shared-derivations batch): `VesselPropulsion`
  // ships CurrentThrust + TotalMass, so TWR = currentThrust/(totalMass·g) is
  // derived client-side on `vessel.state.twr` (vessel-state.ts, standard
  // gravity 9.80665). See TELEMACHUS_CLEAN_HOMES above.

  // comm.signalDelay UN-GAPPED (Step-3 live batch): the old rationale
  // ("aspirational, no implementation") is STALE — comms.delay is live on the
  // wire (CommsCoreUplink, TrueNow) as { oneWaySeconds, source, meta } and is
  // gonogo's OWN SignalDelay authority. CommSignal reads a plain seconds
  // number, so comm.signalDelay -> comms.delay.oneWaySeconds (raw-field walk).
  // See TELEMACHUS_CLEAN_HOMES above.

  // --- M2 Task 7 fix, part 2: ActionGroup's dynamically-resolved keys
  // (see mapTopic.coverage.test.ts's collectDynamicTelemachusKeys). Of the
  // 17 keys, sas/rcs/gear/brake/light have clean 1:1 boolean homes above;
  // the rest don't exist as individual fields on VesselControl
  // (mod/Sitrep.Contract/VesselControl.cs) yet ---

  // v.abortValue UN-GAPPED (P4a command batch): VesselControl now carries a
  // plain `Abort` field (`vessel.control.abort`, camelCase on the wire) —
  // see TELEMACHUS_CLEAN_HOMES above.

  // v.ag1Value..v.ag10Value UN-GAPPED (R6 shared-derivations batch): the
  // fixed-order `VesselControl.actionGroups` bool[] is now split into ten
  // per-index `vessel.state.actionGroup{n}` booleans each ActionGroup widget
  // instance reads as its own bool (plus a dynamic `vessel.state.actionGroups`
  // keyed map for Action Groups Extended's variable count). See
  // TELEMACHUS_CLEAN_HOMES above. (The ActionGroup widget stays hybrid only
  // on precision — `v.precisionControlValue` below.)

  // v.precisionControlValue UN-GAPPED (P4a shared-map batch): VesselControl
  // now carries a `precisionControl` field — see TELEMACHUS_CLEAN_HOMES
  // above (shared with f.precisionControl).

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

  // v.atmosphericTemperature / v.externalTemperature UN-GAPPED (P4a
  // shared-map batch) — see TELEMACHUS_CLEAN_HOMES above.

  // --- thermal detail beyond headline ratios (G-12) ---
  "therm.hottestPartName",
  "therm.hottestEngineTemp",
  "therm.hottestEngineMaxTemp",
  "therm.hottestEngineTempRatio",
  "therm.heatShieldTempCelsius",
  "therm.heatShieldFlux",
  "therm.anyEnginesOverheating",

  // v.crew / v.crewCapacity UN-GAPPED (P4a shared-map batch, G-13) — see
  // TELEMACHUS_CLEAN_HOMES above.

  // v.biome / v.landedAt UN-GAPPED (R6 prep): vessel.surface now ships
  // Biome + LandedAt — see TELEMACHUS_CLEAN_HOMES above.

  // dv.stageCount/dv.stages/dv.totalDVVac/dv.totalDVASL/dv.totalDVActual/
  // dv.totalBurnTime UN-GAPPED (P4a shared-map batch, G-14) — see
  // TELEMACHUS_CLEAN_HOMES above (dv.stages whole-topic + dv.summary.*
  // raw-field walks).

  // --- parts surface — own ASSET-class design, out of M1 ---
  "v.topology",
  "v.topologySeq",
  // robotics.available UN-GAPPED (P4a shared-map batch): a dedicated
  // capability topic now ships — see TELEMACHUS_CLEAN_HOMES above.
  // robotics.rotors/robotics.servos: RotorTachometer/RoboticsConsole read
  // `{partId, name, ...}[]` lists keyed on a numeric `partId` that both
  // commands (robotics.rotor.setRpmLimit[id,...] etc.) and React list
  // selection depend on. `parts.robotics` (M3 science/parts batch,
  // CLEAN_HOMES above) carries the same live hinge/rotor readouts
  // (currentAngle/targetAngle/currentRPM/rpmLimit/normalizedOutput/
  // brakePercentage/servoIsLocked/servoIsMotorized/servoMotorIsEngaged) but
  // NO id field at all — the same "no stable id" shape-mismatch class as the
  // career batch's contracts/strategies gaps. The full identity list (and
  // therefore selection + every command) stays on this legacy read; the two
  // widgets separately read the NEW `parts.robotics` key to merge live
  // numeric values onto the selected part by name (mixed-source pattern).
  // gap: no partId/stable id on the new wire; migrate in M3
  "robotics.rotors",
  "robotics.servos",

  // --- M2 event stream (ReliableOrdered), not this milestone's state model ---
  "crash.hasRecent",
  "crash.lastCrash",

  // v.isControllable UN-GAPPED (R6 shared-derivations batch): derived from
  // vessel.comms.controlState's control LEVEL on vessel.state.isControllable
  // (see TELEMACHUS_CLEAN_HOMES above). f.precisionControl UN-GAPPED (P4a
  // shared-map batch) alongside v.precisionControlValue — see
  // TELEMACHUS_CLEAN_HOMES above.

  // --- derived quantities with no named field on any M1/M2 channel yet ---
  // A-tranche migration UN-GAPPED the cleanly-derivable members of this
  // cluster (o.ApR/o.PeR/o.radius/o.nextApsisType/o.timeToNextApsis/
  // v.horizontalVelocity/tar.distance/tar.o.PeA/tar.o.period/
  // tar.o.trueAnomaly) — all now derived on vessel.state.* (see
  // TELEMACHUS_CLEAN_HOMES above). The keys BELOW are what genuinely can't be
  // honestly derived from the current wire:

  // v.isEVA / v.splashed UN-GAPPED (R6 shared-derivations batch): derived
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
  // gap: needs a facing vector + a defined prograde frame, neither on the wire; migrate in M3
  "v.angleToPrograde",

  // o.closestTgtApprUT UN-GAPPED (R6 shared-derivations batch): the two-body
  // closest-approach solve over vessel.orbit + vessel.target.orbit now runs
  // client-side (propagation.ts's `closestApproach`), exposed on
  // `vessel.state.closestApproachUt`. See TELEMACHUS_CLEAN_HOMES above.

  // dock.ax/dock.ay/dock.az: the true docking-port ORIENTATION misalignment
  // axes aren't on the wire (vessel.dock carries only RelativePosition/
  // RelativeVelocity/Distance + a scalar ForwardDot). R6 §0.0 USER DECISION is
  // to DROP them in favour of the LINE-OF-SIGHT HUD proxy — the shared
  // `deriveDockAngles` helper (packages/components/src/shared/dockAngles.ts,
  // R6 prep) computes ax/ay off dock.relativePosition. They stay gapped here
  // until the DistanceToTarget migrate-widget task removes the legacy reads +
  // reworks the fixtures/snapshots/visual baselines.
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
  // career.mode UN-GAPPED (D1, P4a client-derivations batch): CareerMode is
  // its own raw wire topic ({ mode: GameMode }) — a plain raw-field walk to
  // career.mode.mode (the numeric GameMode ordinal). useGameContext resolves
  // the ordinal to the SANDBOX/CAREER/SCIENCE/Unknown string the widgets
  // read (no vessel.state field needed — see TELEMACHUS_CLEAN_HOMES above).
  "kc.crewRoster",
  // kc.facilityLevels un-gapped M3b career-detail batch — see CLEAN_HOMES
  // above (career.status.facilities, SpaceCenterStatus's parseFacilityLevels
  // now reads BOTH the legacy short-code shape and the new enum-keyed
  // currentTier/maxTier/upgradeCost shape).
  "kc.launchSite",
  "kc.launchSites",
  "kc.padOccupied",
  "kc.padVesselTitle",
  "kc.partsAvailable",
  "kc.savedShips",
  // kc.scene UN-GAPPED (P4a shared-map batch): SpaceCenterScene now ships
  // its own raw topic — see TELEMACHUS_CLEAN_HOMES above.

  // --- M3b career-detail batch: facilities/contracts/strategies/tech
  // un-gapped. The 3069438 capture-extend session (career-capture-extend-
  // report.md) widened CareerViewProvider's facilities/contracts/
  // strategies/tech groups from the M3 "just enough to prove the channel
  // exists" shape to what these five widgets actually need — integer
  // currentTier/maxTier/upgradeCost per facility, a stable string `id` +
  // `parameters` per contract, a stable `id` + full cost/eligibility set
  // per strategy (plus the `all` roster, not just `active`), and
  // `id`/`title`/`scienceCost`/`unlocked`/`parents` per tech node. See
  // CLEAN_HOMES above for the five new mappings and each widget's own
  // parser (ContractManager's `parseContracts`, Strategies's
  // `parseStrategies`, TechTree's `parseTechNodes`, SpaceCenterStatus's
  // `parseFacilityLevels`) for how each now accepts BOTH the legacy shape
  // and this new one. `contracts.completedRecent` is UN-GAPPED as of the P4a
  // shared-map batch — CareerContracts now carries a completedRecent list
  // too, see TELEMACHUS_CLEAN_HOMES above. `strategies.all`'s
  // `effectiveCostReputation` also stays
  // client-side-only — deliberately not added to the wire (no cheap
  // decompiled source for KSP's nonlinear rep curve, career-capture-
  // extend-report.md) — `parseStrategies` already falls back to
  // `initialCostReputation` when it's absent, unchanged by this batch.
  // Commands (facility upgrade, contract accept/decline/cancel, strategy
  // activate/deactivate, tech unlock) have no command home yet
  // (KNOWN_COMMAND_GAPS in map-command.ts) and fall back to the legacy
  // DataSource automatically — this batch migrates READS only.

  // contracts.completedRecent UN-GAPPED (P4a shared-map batch): see
  // TELEMACHUS_CLEAN_HOMES above.

  // sci.count/sci.dataAmount: ScienceBench reads two separate scalar
  // aggregates. `science.experiments` (now CLEAN_HOMES above) carries the
  // raw per-experiment array these were always summarized FROM, but no
  // separate pre-aggregated count/total-dataAmount field exists on the new
  // wire — the widget's two independent `useDataValue` reads for these stay
  // on the legacy path this batch rather than being rewritten to derive
  // client-side from the (now migrated) experiments array.
  // gap: no aggregate field on the new wire; migrate in M3
  "sci.count",
  "sci.dataAmount",
  // sci.experimentBreakdown: GonogoTelemetry-only enriched shape (biome/
  // situation/remainingPotential per subject) — no equivalent on the M1/M2
  // science channel at all.
  // gap: GonogoTelemetry-only enrichment, no new-wire equivalent; migrate in M3
  "sci.experimentBreakdown",
  // sci.instruments UN-GAPPED (P4a shared-map batch): a per-instrument list
  // now ships as its own topic — see TELEMACHUS_CLEAN_HOMES above. It is a
  // DIFFERENT array from science.lab (the Mobile Processing Lab).
  "s.sensor.temp",
  "s.sensor.pres",
  "s.sensor.grav",
  "s.sensor.acc",
  // deployed.bases un-gapped M3 science-domain finale — see CLEAN_HOMES
  // above (science.deployed, DeployedScience's parseBases now reads BOTH
  // the legacy grouped-base shape and the new flat-per-experiment shape).
  // deployed.available UN-GAPPED (P4a shared-map batch): the old "can't
  // disambiguate no-DLC from empty-deployed" rationale was stale —
  // GameDlc.breakingGround is its own independent capability boolean, not
  // derived from science.deployed's emptiness. See TELEMACHUS_CLEAN_HOMES
  // above.
  "mh.score",
  "mh.objectives",
  "mh.available",
  "mh.finished",
  "mh.name",
  "mh.outcome",
  "mh.phase",
  "scansat.available",
  "scansat.scanningVessels",
  // ksp.canRevertToEditor / ksp.canRevertToLaunch UN-GAPPED (P4a shared-map
  // batch): a dedicated RevertAvailability topic now ships both flags — see
  // TELEMACHUS_CLEAN_HOMES above.
]);

/**
 * Resolve a widget-facing `(dataSourceId, key)` pair — as passed to
 * `useDataValue` today — to the new SDK stream topic it should read from.
 *
 * Returns `undefined` when there is no mapping: either `dataSourceId` isn't
 * the Telemachus `"data"` source (nothing else is wired to the new SDK in
 * M2), or `key` is a known, explicitly-tracked gap (`TELEMACHUS_KNOWN_GAPS`),
 * or `key` is genuinely unrecognized. In every `undefined` case the
 * `@ksp-gonogo/core` `useDataValue` shim falls back to the legacy `DataSource`
 * path — this function intentionally does NOT identity-fallback (contrast
 * with `redirectKinematicSubtopic` above).
 */
/**
 * `kos.compute.<id>.<field>` — the dynamic centralised-compute namespace.
 * Identity-mapped so a future compute-feed slice reads straight off the
 * stream; `.status` sub-topics and `.dispatchNow`/`.reEnable` command keys
 * are deliberately excluded (status has no P1 producer; commands never route
 * through `useDataValue`).
 */
const KOS_COMPUTE_FIELD = /^kos\.compute\.[\w-]+\.[\w-]+$/;
const KOS_COMPUTE_NON_VALUE =
  /^kos\.compute\.[\w-]+\.(status|dispatchNow|reEnable)$/;

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

  if (BODY_INDEXED_CLEAN.test(key)) return "system.bodies";
  if (BODY_INDEXED_GAP.test(key)) return undefined;

  const resourceMatch = RESOURCE_VESSEL_TOTAL.exec(key);
  if (resourceMatch) {
    const [, isMax, name] = resourceMatch;
    return `vessel.resources.resources.${name}.${isMax ? "max" : "current"}`;
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
