/**
 * Default per-topic list feeding the carried-channels gate in
 * `carried-channels.ts`. These are the RAW wire topics whose fields the value
 * pickers offer. The gate resolves each derived topic down to its raw wire
 * inputs and counts it carried only when EVERY input is carried, so the list
 * is written at raw-topic granularity.
 *
 * No read consults it: a read subscribes whatever it names, listed or not.
 * What it decides is the field catalogue, and through that which keys an
 * operator can pick for an alarm, a graph series or a note tag.
 *
 * Lives in this SDK so both the app (`SitrepTelemetryProvider`'s default
 * `carriedChannels` prop) and `@ksp-gonogo/data` (the field catalogue behind
 * `useDataSchema`) read one list without `data` depending on `app`.
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
 *
 * CHANNELS only. A command id is not a channel and has no value to pick.
 */
export const DEFAULT_SITREP_CARRIED_TOPICS: readonly string[] = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "vessel.control",
  "vessel.comms",
  "vessel.propulsion",
  "vessel.attitude",
  "vessel.thermal",
  "vessel.structure",
  "vessel.parts",
  "vessel.crew",
  "vessel.resources",
  "vessel.target",
  "vessel.maneuver",
  "vessel.dock",
  "vessel.surface",
  "system.bodies",
  "system.vessels",
  "system.uplinks",
  "time.warp",
  "time.calendar",
  "comms.delay",
  "comms.link",
  "comms.degrade",
  "comms.commandCentre",
  "comms.path",
  "comms.network",
  "system.uplink.pending",
  "system.uplink.gates",
  "system.channels",
  "kos.processors",
  "career.mode",
  "science.sensors",
  "game.dlc",
  "robotics.available",
  "ksp.revertAvailability",
  "spaceCenter.scene",
  "career.status",
  "science.instruments",
  "dv.stages",
  "dv.summary",
  "parts.power",
  "robotics.servos",
  "science.experiments",
  "science.experimentBreakdown",
  "science.lab",
  "science.archive",
  "deployed.bases",
  "spaceCenter.crewRoster",
  "spaceCenter.savedShips",
  "spaceCenter.partsAvailable",
  "spaceCenter.launchSites",
  "spaceCenter.pois",
  "spaceCenter.astronautComplex",
  "crash.lastCrash",
  "crash.hasRecent",
  "recovery.lastSummary",
  "recovery.hasRecent",
  "scansat.available",
  "scansat.scanningVessels",
  "kerbcast.available",
  "kerbcast.cameras",
  "flight.current",
  "flight.started",
  "flight.ended",
  "flight.vesselChanged",
  "flight.simulation",
  "alarm.scet",
  "alarm.scet.fired",
  "settings.gonogo",
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
 *     as a `startsWith` prefix. `TelemetryProvider` folds these into the
 *     carried set it builds.
 *
 * A real wire topic never ends in `.`, so a prefix sentinel never collides with
 * the exact-membership checks these lists also serve.
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
