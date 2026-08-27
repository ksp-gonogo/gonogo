// The fog-of-war mask store, cache and context moved to `@ksp-gonogo/sitrep-sdk`.
// The Uplink that contributes coverage is the only consumer, and its own tests
// build a `FogMaskStore` inside a `FogMaskCacheProvider` to assert what a scan
// revealed; reaching either meant importing this package, which is `private: true`.
// `useFogMaskCache` was published as a host shim, so the read half was reachable and
// the construction half was not.
//
// The CONTEXT is why they had to move rather than staying shimmed: a provider from a
// second copy is invisible to a consumer of the other, silently, which is the
// failure the shim existed to prevent. With one context in one published package
// there is no second copy, so that shim retires.
//
// Re-exported so this package's importers keep their import site.
// The buffered-recording subsystem moved to `@ksp-gonogo/sitrep-sdk`: an Uplink's
// tests build a `BufferedDataSource` over a `MemoryStore` to assert what its
// widgets read, and this package is `private: true`, so that harness was
// unbuildable outside this repo. Its transitive closure was twelve files that
// named nothing above the sdk leaf, so nothing was reimplemented.
//
// Re-exported so this package's importers keep their import site.
export {
  type BodyMask,
  BufferedDataSource,
  clearDerivedKeys,
  DataSourceWrapper,
  DEFAULT_KEEP_COUNT,
  DEFAULT_MASK_HEIGHT,
  DEFAULT_MASK_WIDTH,
  DEFAULT_PROFILE_ID,
  type DerivedKeyDef,
  type DetectorDecision,
  type DetectorInput,
  debugFlight,
  type ExportFlightOptions,
  exportFlightToFixture,
  FLIGHT_FIXTURE_FORMAT,
  FLIGHTS_DESC,
  type FlightChapter,
  FlightDetector,
  type FlightFixture,
  type FlightStore,
  FogMaskCache,
  FogMaskCacheProvider,
  type FogMaskChangeListener,
  FogMaskStore,
  FogMaskStoreProvider,
  fixtureDurationMs,
  getDerivedKeys,
  getKeepCount,
  importFixtureToStore,
  isFlightFixture,
  type KeyEnricher,
  KeyedListenerSet,
  ListenerSet,
  LocalStorageStore,
  type LocalStorageStoreOptions,
  MASK_SCHEMA_VERSION,
  MemoryStore,
  registerDerivedKey,
  type StoredMask,
  setKeepCount,
  subscribeAutoDelete,
  useBodyFogMask,
  useFogMaskCache,
  useFogMaskStore,
} from "@ksp-gonogo/sitrep-sdk";
export * from "./FlightsFab";
export * from "./FlightsManager";
export type { AutoRecordControllerProps } from "./FlightsManager/AutoRecordController";
export { AutoRecordController } from "./FlightsManager/AutoRecordController";
export * from "./FlightsManager/autoRecordStatus";
export { MissionHistorySource } from "./FlightsManager/MissionHistorySource";
export * from "./hooks/useDataSchema";
export * from "./hooks/useDataSeries";
export * from "./hooks/useFlight";
export * from "./hooks/useManeuverFeasibility";
export * from "./hooks/useManeuverNodes";
export * from "./hooks/usePartsLive";
export * from "./hooks/useTopology";
export * from "./hooks/useValueKeys";
// `buildResourcesByFlightId`: the pure per-flightId resources lookup
// `usePartsLive` builds internally, also needed by ShipMap's built-in
// `ship-map.part-meters` contribution (a plain function of the same
// `vessel.parts` Topic payload, evaluated outside React by the contribution
// aggregator, so it can't go through the hook).
export { buildResourcesByFlightId } from "./hooks/vesselPartsAdapter";
export * from "./replaySession/ReplaySessionBanner";
export * from "./replaySession/ReplaySessionController";
export * from "./replaySession/ReplaySessionProvider";
export { registerBuiltinDerivedKeys } from "./schema/builtinDerivedKeys";
export {
  getTopicFieldCatalog,
  getUndescribedCarriedTopics,
  humaniseFieldPath,
  isThresholdSubject,
  type TopicFieldKey,
} from "./schema/topicFieldCatalog";
export { IndexedDbStore } from "./storage/IndexedDbStore";
export type {
  MissionMeta,
  MissionRecord,
  VideoRecordingRef,
} from "./storage/MissionStore";
export { MissionStore } from "./storage/MissionStore";
export * from "./types";
