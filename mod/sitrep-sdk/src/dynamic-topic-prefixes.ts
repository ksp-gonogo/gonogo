/**
 * Namespace PREFIXES (each ends in `.`) whose member topics are keyed by
 * something the contract never names up front: a body and a scan type, a
 * vessel guid, a part's flight id. `TimelineStore`'s `dynamicWholeTopicPrefixes`
 * resolves a topic under one of these to its IDENTITY, a whole raw wire topic,
 * rather than mis-splitting it into a `<domain.channel>.<fieldPath>` that is
 * never published.
 *
 * The SCANsat entries are exactly `ScanChannels.{Coverage,Mask,Height,Biome,
 * Anomalies}Prefix` in that Uplink's mod, and its `scansat-wire-contract` test
 * asserts the two lists stay equal. A real wire topic never ends in `.`, so a
 * prefix never collides with an exact topic id.
 */
export const DYNAMIC_WHOLE_TOPIC_PREFIXES: readonly string[] = [
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
  // revealed at their source vessel's own light-time. One prefix covers the whole
  // per-vessel namespace, same as fleet. above.
  "currency.",
  // vessel.partActions.<flightId>: the per-part PAW action lists (mod's
  // PartActionsViewProvider.TopicPrefix). One prefix covers every part, which is
  // the only workable form here: the keys are per-part and only ever computed at
  // interaction time, so they cannot be enumerated up front. The mod only
  // PRODUCES a part's channel while that part is subscribed, so covering the
  // whole prefix costs nothing for parts nobody has open.
  "vessel.partActions.",
];
