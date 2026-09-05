/**
 * Default dev-first per-topic promotion list, feeding the carried-channels
 * gate in `carried-channels.ts`. These are the RAW wire
 * topics the mod's `VesselViewProvider`/`SystemViewProvider`/`TimeViewProvider`
 * are known to serve, the `useDataValue` shim resolves each mapped/derived
 * topic down to its raw wire inputs and only routes to the stream when EVERY
 * input is carried, so promotion is done at raw-topic granularity here.
 *
 * This is deliberately an explicit opt-in list rather than a hard-coded
 * transport declaration: the mod server does not yet advertise a channel list
 * on connect, so until it does, this dev list is how a topic is reliably
 * promoted to the stream. The stream transport additionally marks channels
 * carried as their frames first arrive (best-effort fallback), but that grows
 * too late to flip this gate for the current session, so it is informational
 * only for now.
 *
 * Lives in `@ksp-gonogo/sitrep-client`, not `@ksp-gonogo/app`, so both the app
 * (`SitrepTelemetryProvider`'s default `carriedChannels` prop, re-exported
 * from there for backward compatibility) and `@ksp-gonogo/data` (the legacy
 * `"data"` key-catalog builder in `hooks/useDataSchema.ts`, which needs the
 * same mapped-AND-carried gate `isTopicCarried` implements) can read it
 * without `data` taking a dependency on `app`, `app` already depends on
 * `data`, so the reverse would be circular. One list, read from the lowest
 * layer both consumers already share.
 *
 * It decides NOTHING about station screens. A station receives a topic because
 * a widget mounted on it subscribed, which reaches the mod through
 * `SitrepPeerRelay`'s refcounted sink; a topic missing from here is as
 * reachable from a station as one on it. Adding an entry to help a station is
 * always the wrong fix.
 *
 * A topic an Uplink installed this morning could never be on a list written
 * here, and no longer needs to be: `TelemetryProvider` folds in every Topic a
 * client package registered at runtime
 * (`registerBarePrimitiveTopic`/`runtime-topic-registry.ts`) on top of this
 * list. So this is the FIRST-PARTY floor, not the whole answer. The Uplink
 * entries still below it are first-party Uplinks whose Topics come through
 * codegen into this SDK; they are harmless duplicates of what registration now
 * promotes, and adding a new one here is never how an Uplink gets carried.
 */
export const DEFAULT_SITREP_CARRIED_TOPICS: readonly string[] = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "vessel.control",
  "vessel.comms",
  // Source of the client-derived `vessel.state.twr` (old `dv.currentTWR`).
  // Also a declared input of `vesselStateChannel`, and the gate is
  // parent-channel-scoped, so it must be carried for ANY `vessel.state.*`
  // field to resolve at all.
  "vessel.propulsion",
  "vessel.attitude",
  "vessel.thermal",
  "vessel.structure",
  // The structural part-tree channel, read canonically by `useTopology` and by
  // `usePartsLive`'s thermal join (`@ksp-gonogo/data`). Both bypass this gate
  // the same way vessel.orbit's OrbitView read does, so the entry is not
  // load-bearing for them; it is here for the "every mod-served raw topic is
  // catalogued" convention the rest of this list follows.
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
  // built-in system.uplinks channel: see uplink-health.ts's derived
  // systemUplinkHealthChannel). Must be carried or Settings' per-Uplink
  // health rows silently fall back to nothing (there is no legacy
  // legacy equivalent).
  "system.uplinks",
  "time.warp",
  // time.calendar: how long a day and a year are in the game being watched.
  // Not telemetry, a DEFINITION, and everything that prints a duration or a
  // date reads it: a planet pack or the stock KERBIN_TIME setting moves both,
  // and without this topic the app quietly holds Kerbin's 6-hour day and is
  // four times wrong about every "3 days to depletion" on screen.
  "time.calendar",
  // Comms signal-delay channel (CommsCoreUplink, TrueNow): the headline
  // delay readout behind CommSignal's comm.signalDelay.
  "comms.delay",
  // Comms connectivity MetaTopic (CommsCoreUplink, Delayed + freeze-EXEMPT),
  // the client-facing link up/down behind the comm.connected mapped key
  // (SignalLossIndicator / CameraFeed / CommSignal / ActionGroup). MUST be
  // carried or the disconnect edge never reaches the client and "NO SIGNAL"
  // never fires: see comms-delay-model-consistency spec.
  "comms.link",
  // comms.degrade (CommsCoreUplink, Delayed): the elected backend's own 0..1
  // grading of the link, with the rule that produced it named alongside. The
  // one number a consumer choosing a quality (a video feed's bitrate, a voice
  // channel's noise) can key on without knowing which comms mod is installed,
  // which `comms.signalStrength` cannot be: that field means a different
  // quantity depending on which backend the comms capability elected, and the
  // grading here names its own rule. Must be
  // carried or a `useTelemetry("comms.degrade")` read silently stays undefined,
  // which a consumer is meant to read as "nobody graded this" and would here be
  // "nobody delivered it".
  "comms.degrade",
  // comms.commandCentre (CommsCoreUplink, TrueNow): which centre (KSC or a
  // crewed control-source vessel) the
  // active vessel's own comms link currently terminates at. CommSignal reads
  // it to label its readout with the real centre instead of assuming KSC;
  // must be carried or that read silently stays undefined.
  "comms.commandCentre",
  // System View / Fleet-Comms augment: active-vessel comms-path highlight +
  // command-traffic (pending-uplink) overlay, read via `useLatestValue`
  // (dispatch-time bookkeeping, TrueNow). Connectivity styling reads the
  // `comms.link` MetaTopic listed above, so `comms.connectivity` is
  // deliberately absent from this list: no client reads it, and the TrueNow
  // `comms.*` observation channels stay un-publicised.
  "comms.path",
  // CommNet relay graph: the `system-view-vessel-orbits` contribution reads
  // it to draw the relay network as faint connection-line entities. That
  // contribution subscribes directly, since `ContributionsProvider`'s
  // `SlotAggregator` bypasses this gate entirely, so listing it here is not
  // load-bearing for that path. It is listed for the same "every mod-served
  // raw topic is catalogued" convention the rest of this list follows, and
  // so a direct `useTelemetry("comms.network")` read does not silently fall
  // back to legacy.
  "comms.network",
  "system.uplink.pending",
  // system.uplink.gates: every gated command's standing verdict, read by
  // `useCommand` so a control can be drawn dark before the operator presses it.
  // MUST be carried or every gated control renders as though nothing were
  // gated, which is the state the whole gate mechanism was built to leave.
  "system.uplink.gates",
  // system.channels: every declared channel's emission counters, the reading
  // that tells a Topic the engine never considered from one it considered and
  // declined. Listed because a gate entry costs nothing on its own: it decides
  // whether a READ routes to the stream, and nothing subscribes until something
  // asks. Left off, a `useTelemetry("system.channels")` would fall back to the
  // legacy source and find no such key, so the diagnostic would be reachable by
  // a raw socket and not by the app that needs it.
  "system.channels",
  // U3 kOS slice: native push channel for the KosProcessors widget. Static
  // raw topic, so `isTopicCarried` promotes it by simple set membership. The
  // dynamic `kos.compute.<id>.<field>` namespace is intentionally NOT here,
  // it is served by `BufferedDataSource` (the kOS DataSource fanout), which
  // bypasses this stream carried-channels gate entirely, so it needs no
  // prefix entry here (unlike the scansat dynamic namespaces below).
  "kos.processors",
  // career.mode feeds useGameContext's career-mode display map.
  // science.sensors is the whole-topic sensor-by-type roster.
  "career.mode",
  "science.sensors",
  // The remaining trivial raw-field-walk and whole-topic reads. Naming a topic
  // as some widget-facing key's home without promoting it here leaves every one
  // of those reads uncarried, which is what career.status did to its facility
  // levels, contracts, strategies and tech-node fields until it was added.
  "game.dlc",
  "robotics.available",
  "ksp.revertAvailability",
  "spaceCenter.scene",
  "career.status",
  "science.instruments",
  "dv.stages",
  "dv.summary",
  // Mod-served topics that back a widget-facing key: they must be promoted here
  // or `isTopicCarried` refuses the read and it falls back to the legacy source
  // instead of the stream. Three of them (parts.power, robotics.servos,
  // science.lab) have no legacy equivalent at all, so the stream is their only
  // source of data.
  "parts.power",
  "robotics.servos",
  "science.experiments",
  "science.experimentBreakdown",
  "science.lab",
  // science.archive: the career-wide R&D archive (ScienceData's Archive tab),
  // a new capability with no legacy read, so the stream is its only source.
  "science.archive",
  "deployed.bases",
  // The homes of AstronautComplex's, LaunchDirector's and SpaceCenterStatus's kc.crewRoster/kc.savedShips/kc.partsAvailable reads, under the same promotion rule as every mod-served topic above.
  "spaceCenter.crewRoster",
  "spaceCenter.savedShips",
  "spaceCenter.partsAvailable",
  // LaunchDirector's kc.launchSites picker roster, and the input spaceCenter.state derives kc.padOccupied/kc.padVesselTitle from.
  "spaceCenter.launchSites",
  // The map points-of-interest feed (KSC, launch sites, and active and offered
  // contract targets) MapView's vanilla POI provider reads. No legacy
  // equivalent, so the stream is its only source of data.
  "spaceCenter.pois",
  // AstronautComplex's applicant pool, roster cap and active-crew count.
  // No legacy equivalent, so the stream is its only source of data.
  "spaceCenter.astronautComplex",
  // Crash event stream (CrashUplink, ReliableOrdered): the crashed-vessel
  // record and its companion "a notable crash happened recently" flag. Raw
  // wire topics; the gate promotes at raw-topic granularity, so a widget
  // reading them through `useDataValue` reaches the stream instead of the
  // legacy source. Delivered on the reliable lane, so every crash
  // arrives (none coalesced); consumers that must act once per crash use
  // `useStreamEvent` rather than a sticky value read.
  "crash.lastCrash",
  "crash.hasRecent",
  // Recovery event stream (RecoveryUplink, ReliableOrdered): the
  // recovery-side counterpart of the crash pair immediately above, the
  // recovered-vessel summary record and its companion "a notable recovery
  // happened recently" flag. Same raw-topic promotion rule.
  "recovery.lastSummary",
  "recovery.hasRecent",
  // scansat.available/scansat.scanningVessels: the two STATIC SCANsat
  // topics GonogoScansatUplink always publishes (see ScansatUplink.cs's
  // AvailableTopic/ScanningVesselsTopic consts): same "must be promoted or
  // stays on the legacy read" rule as the science.* siblings above. The
  // dynamic scansat.coverage/mask/height/biome/anomalies.<body>.<type>
  // namespace is mapped in map-topic.ts's SCANSAT_DYNAMIC and per-(body,type),
  // so it can't be an exact entry here, it is carried by
  // `DYNAMIC_CARRIED_TOPIC_PREFIXES` (below), which `TelemetryProvider` folds
  // into the carried set and `isTopicCarried` matches by prefix. Before that
  // landed, those coverage/mask/height/biome/anomaly reads silently
  // fell back to the removed legacy source even though mapTopic resolved them,
  // the "coverage never surfaces" client half.
  "scansat.available",
  "scansat.scanningVessels",
  // kerbcast.available/kerbcast.cameras: the two STATIC topics
  // GonogoKerbcastUplink publishes (see KerbcastUplink.cs's AvailableTopic/
  // CamerasTopic consts): kerbcast's CONTROL plane (camera inventory,
  // capabilities, docking-port association). Same promotion rule as the
  // scansat siblings above.
  //
  // kerbcast's VIDEO is deliberately absent and always will be: the H.264
  // stream runs sidecar -> browser over WebRTC and is not a Topic at all.
  // Only the control plane rides the wire.
  //
  // Promotion here is an allowlist, not a subscription, nothing flows until
  // a widget actually reads these. Listing them now means the control plane
  // is reachable the moment a consumer lands, rather than silently resolving
  // to the legacy path.
  "kerbcast.available",
  "kerbcast.cameras",
  // Flight-lifecycle domain (FlightUplink, P4c-b flight-lifecycle spec):
  // flight.current (LossyLatest Value) plus flight.started/ended/
  // vesselChanged (ReliableOrdered events): retires the client-side
  // FlightDetector heuristic. Raw wire topics, same promotion rule as
  // crash.*/recovery.* above. AutoRecordController/useFlight read these
  // natively (useOptionalStreamEvent/useStream, bypassing the legacy "data"
  // DataSource + mapTopic shim entirely), so this entry is for any future
  // useTelemetry consumer of the flight.* topics, not those two.
  "flight.current",
  "flight.started",
  "flight.ended",
  "flight.vesselChanged",
  // flight.simulation: whether the flight everything above describes is a
  // REHEARSAL. TrueNow, absent under a game with no such concept, and carried
  // here rather than left to a widget's own promotion because a board that
  // silently omits it reports a simulation as a mission.
  "flight.simulation",
];

/**
 * Canonical dynamic-namespace PREFIXES (each ends in `.`) for the SCANsat
 * per-(body,type) topics whose exact keys can't be enumerated up front,
 * `scansat.coverage.<body>.<typeBit>` / `scansat.mask.<body>.<typeBit>` (4-seg,
 * per-body-per-type) and `scansat.{height,biome,anomalies}.<body>` (3-seg,
 * per-body). These are exactly `ScanChannels.{Coverage,Mask,Height,Biome,
 * Anomalies}Prefix` (mod/GonogoScansatUplink/ScanChannels.cs): the
 * `scansat-wire-contract` test asserts the two lists stay equal so a future
 * namespace can't drift.
 *
 * ONE source of truth consumed at BOTH client chokepoints for these dynamic
 * topics (the whole reason the pipeline's static-2-segment assumptions miss
 * them):
 *   • `TimelineStore` (`dynamicWholeTopicPrefixes` option) resolves a topic
 *     under one of these to its IDENTITY, a whole raw wire topic: instead of
 *     mis-splitting it into a `<domain.channel>.<fieldPath>` that is never
 *     published.
 *   • the carried-channels gate (`isTopicCarried`) treats a trailing-`.` entry
 *     as a `startsWith` prefix, so the dynamic key routes to the stream instead
 *     of the removed legacy source. `TelemetryProvider` folds these into the
 *     carried set it builds.
 *
 * A real wire topic never ends in `.`, so a prefix sentinel never collides with
 * the exact-membership checks these lists also serve. kos.compute.* is NOT here:
 * it rides `BufferedDataSource`, not this stream path.
 */
export const DYNAMIC_CARRIED_TOPIC_PREFIXES: readonly string[] = [
  "scansat.coverage.",
  "scansat.mask.",
  "scansat.height.",
  "scansat.biome.",
  "scansat.anomalies.",
  // fleet.<guid>.orbit, fleet.<guid>.delay and fleet.<guid>.contact. One prefix
  // carries the whole per-vessel namespace, so the store timelines each
  // vessel's delayed elements, link and core-contact facts and useStream
  // samples them into a dead-reckoned fleet position and FleetRoster's per-row
  // delay.
  "fleet.",
  // silence.<guid>.state, the comms-owned SilenceTracker reckoning for one
  // vessel. It gets a namespace of its own rather than joining fleet. above
  // because the core fleet facts and the comms model's opinion of them are
  // separately owned (see mod/Sitrep.Host/ChannelEngine.cs's
  // SilenceEventPrefix).
  "silence.",
  // currency.<guid>.science (+ .reputation): source-attributed currency events,
  // revealed at their source vessel's own light-time. One prefix carries the whole
  // per-vessel namespace, same as fleet. above.
  "currency.",
  // vessel.partActions.<flightId>: the per-part PAW action lists (mod's
  // PartActionsViewProvider.TopicPrefix). One prefix carries every part, which is
  // the only workable form here: the keys are per-part and only ever computed at
  // interaction time, so they cannot be enumerated up front. The mod only
  // PRODUCES a part's channel while that part is subscribed, so carrying the
  // whole prefix costs nothing for parts nobody has open.
  "vessel.partActions.",
];
