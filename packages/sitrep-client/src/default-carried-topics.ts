/**
 * Default dev-first per-topic promotion list (browser-transport brief §2/§3,
 * `m3-migration-plan.md` §5.1 carried-channels gate). These are the RAW wire
 * topics the mod's `VesselViewProvider`/`SystemViewProvider`/`TimeViewProvider`
 * are known to serve — the `useDataValue` shim resolves each mapped/derived
 * topic down to its raw wire inputs and only routes to the stream when EVERY
 * input is carried, so promotion is done at raw-topic granularity here.
 *
 * This is deliberately an explicit opt-in list rather than a hard-coded
 * transport declaration: the mod server does not yet advertise a channel list
 * on connect, so until it does, this dev list is how a topic is reliably
 * promoted to the stream. `WebSocketTransport` additionally marks channels
 * carried as their frames first arrive (best-effort fallback) — but that grows
 * too late to flip this gate for the current session, so it is informational
 * only for now.
 *
 * Lives in `@ksp-gonogo/sitrep-client`, not `@ksp-gonogo/app`, so both the app
 * (`SitrepTelemetryProvider`'s default `carriedChannels` prop, re-exported
 * from there for backward compatibility) and `@ksp-gonogo/data` (the legacy
 * `"data"` key-catalog builder in `hooks/useDataSchema.ts`, which needs the
 * same mapped-AND-carried gate `isTopicCarried` implements) can read it
 * without `data` taking a dependency on `app` — `app` already depends on
 * `data`, so the reverse would be circular. One list, read from the lowest
 * layer both consumers already share.
 */
export const DEFAULT_SITREP_CARRIED_TOPICS: readonly string[] = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "vessel.control",
  "vessel.comms",
  // R6 shared-derivations: source of the client-derived `vessel.state.twr`
  // (old `dv.currentTWR`) — a declared input of `vesselStateChannel`, so it
  // must be carried for ANY `vessel.state.*` field to resolve (the gate is
  // parent-channel-scoped).
  "vessel.propulsion",
  "vessel.attitude",
  "vessel.thermal",
  "vessel.structure",
  // vessel.parts: the structural part-tree channel `useTopology`/
  // `usePartsLive`'s thermal join read canonically (`@ksp-gonogo/data`, both
  // bypass this gate the same way vessel.orbit's OrbitView read does) — listed
  // here anyway for the same "every mod-served raw topic is catalogued"
  // convention the rest of this list follows.
  "vessel.parts",
  "vessel.crew",
  "vessel.resources",
  "vessel.target",
  "vessel.maneuver",
  "vessel.dock",
  "vessel.surface",
  "system.bodies",
  "system.vessels",
  // system.uplinks: the mod-side Uplink health self-report (ChannelEngine's
  // built-in system.uplinks channel — see uplink-health.ts's derived
  // systemUplinkHealthChannel). Must be carried or Settings' per-Uplink
  // health rows silently fall back to nothing (there is no legacy
  // Telemachus equivalent).
  "system.uplinks",
  "time.warp",
  // Comms signal-delay channel (CommsCoreUplink, TrueNow) — the headline
  // delay readout behind CommSignal's comm.signalDelay.
  "comms.delay",
  // Comms connectivity MetaTopic (CommsCoreUplink, Delayed + freeze-EXEMPT) —
  // the client-facing link up/down behind the comm.connected mapped key
  // (SignalLossIndicator / CameraFeed / CommSignal / ActionGroup). MUST be
  // carried or the disconnect edge never reaches the client and "NO SIGNAL"
  // never fires — see comms-delay-model-consistency spec.
  "comms.link",
  // System View / Fleet-Comms augment (Phase 1 spine,
  // docs/superpowers/specs/2026-07-15-system-view-fleet-comms-design.md):
  // active-vessel comms-path highlight + connectivity styling + command-traffic
  // (pending-uplink) overlay, read via `useLatestValue`. NOTE `comms.connectivity`
  // is a TEMPORARY bootstrap — the augment should migrate to the `comms.link`
  // MetaTopic above now that it's carried (follow-up:
  // 2026-07-16-fleetcomms-use-comms-link.md). `comms.network` deliberately NOT
  // listed (Phase 1 doesn't draw the relay graph — Phase 2).
  "comms.path",
  "comms.connectivity",
  "system.uplink.pending",
  // U3 kOS slice: native push channel for the KosProcessors widget. Static
  // raw topic, so `isTopicCarried` promotes it by simple set membership. The
  // dynamic `kos.compute.<id>.<field>` namespace is intentionally NOT here —
  // those strings aren't known up front and need a prefix/glob extension to
  // the carried gate (deferred to the compute-feed slice).
  "kos.processors",
  // P4a client-derivations batch: career.mode (D1, useGameContext's career
  // mode display map) and science.sensors (D2, ScienceBench's whole-topic
  // sensor-by-type filter).
  "career.mode",
  "science.sensors",
  // P4a shared-map batch: remaining trivial raw-field-walk + whole-topic
  // reads (map-topic.ts's TELEMACHUS_CLEAN_HOMES). career.status is also
  // newly required here — the M3b career-detail batch mapped
  // kc.facilityLevels/contracts.*/strategies.all/tech.nodes onto it but
  // never added it to this carried list, so those reads have been silently
  // falling back to legacy the whole time; contracts.completedRecent (this
  // batch) needs the same topic.
  "game.dlc",
  "robotics.available",
  "ksp.revertAvailability",
  "spaceCenter.scene",
  "career.status",
  "science.instruments",
  "dv.stages",
  "dv.summary",
  // Mod-served topics mapped in TELEMACHUS_CLEAN_HOMES: they must be promoted
  // here or `isTopicCarried` routes their reads to the legacy source instead of
  // the stream. parts.robotics, parts.power and science.lab have no legacy
  // equivalent, so the stream is their only source of data.
  "parts.power",
  "parts.robotics",
  "science.experiments",
  "science.experimentBreakdown",
  "science.lab",
  "science.deployed",
  // spaceCenter.crewRoster/savedShips/partsAvailable: StaffRoster/
  // LaunchDirector/SpaceCenterStatus's kc.crewRoster/kc.savedShips/
  // kc.partsAvailable reads are now mapped in TELEMACHUS_CLEAN_HOMES — same
  // "must be promoted or it silently stays on the legacy read" rule as
  // every other mod-served topic above.
  "spaceCenter.crewRoster",
  "spaceCenter.savedShips",
  "spaceCenter.partsAvailable",
  // spaceCenter.launchSites: LaunchDirector's kc.launchSites picker roster,
  // plus the input the spaceCenter.state derived channel reads for the
  // kc.padOccupied/kc.padVesselTitle pair — must be promoted or those reads
  // silently stay on the legacy Telemachus source.
  "spaceCenter.launchSites",
  // Crash event stream (CrashUplink, ReliableOrdered): the crashed-vessel
  // record and its companion "a notable crash happened recently" flag. Raw
  // wire topics — the gate promotes at raw-topic granularity — so a widget
  // reading them through `useDataValue` reaches the stream instead of the
  // legacy Telemachus source. Delivered on the reliable lane, so every crash
  // arrives (none coalesced); consumers that must act once per crash use
  // `useStreamEvent` rather than a sticky value read.
  "crash.lastCrash",
  "crash.hasRecent",
  // Recovery event stream (RecoveryUplink, ReliableOrdered): the
  // recovery-side counterpart of the crash pair immediately above — the
  // recovered-vessel summary record and its companion "a notable recovery
  // happened recently" flag. Same raw-topic promotion rule.
  "recovery.lastSummary",
  "recovery.hasRecent",
  // scansat.available/scansat.scanningVessels: the two STATIC SCANsat
  // topics GonogoScansatUplink always publishes (see ScansatUplink.cs's
  // AvailableTopic/ScanningVesselsTopic consts) — same "must be promoted or
  // stays on the legacy read" rule as the science.* siblings above. The
  // dynamic scansat.coverage/mask/height/biome/anomalies.<body>.<type>
  // namespace is mapped in map-topic.ts's SCANSAT_DYNAMIC but deliberately
  // NOT listed here: this allowlist is a literal-string set and those keys
  // are per-(body,type) — same unenumerable-dynamic-namespace gap already
  // flagged for kos.compute.<id>.<field> above (needs a prefix/glob
  // extension to the carried-channels gate, not yet built). Until that
  // lands, the fog-of-war coverage/mask/height/biome reads — and, as of the
  // P4c-b anomaly-overlay build, the AnomalyOverlay augment's anomaly reads
  // too — stay on the legacy source even though mapTopic resolves them.
  "scansat.available",
  "scansat.scanningVessels",
  // Flight-lifecycle domain (FlightUplink, P4c-b flight-lifecycle spec):
  // flight.current (LossyLatest Value) plus flight.started/ended/
  // vesselChanged (ReliableOrdered events) — retires the client-side
  // FlightDetector heuristic. Raw wire topics, same promotion rule as
  // crash.*/recovery.* above. AutoRecordController/useFlight read these
  // natively (useOptionalStreamEvent/useStream, bypassing the legacy "data"
  // DataSource + mapTopic shim entirely), so this entry is for any future
  // useDataValue("data", "flight.*") consumer, not those two.
  "flight.current",
  "flight.started",
  "flight.ended",
  "flight.vesselChanged",
];
