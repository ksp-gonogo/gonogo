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
export {
  type BodyMask,
  DEFAULT_MASK_HEIGHT,
  DEFAULT_MASK_WIDTH,
  DEFAULT_PROFILE_ID,
  FogMaskCache,
  FogMaskCacheProvider,
  type FogMaskChangeListener,
  FogMaskStore,
  FogMaskStoreProvider,
  MASK_SCHEMA_VERSION,
  type StoredMask,
  useBodyFogMask,
  useFogMaskCache,
  useFogMaskStore,
} from "@ksp-gonogo/sitrep-sdk";
export * from "./BufferedDataSource";
export * from "./DataSourceWrapper";
export * from "./derive";
export * from "./FlightsFab";
export * from "./FlightsManager";
export type { AutoRecordControllerProps } from "./FlightsManager/AutoRecordController";
export { AutoRecordController } from "./FlightsManager/AutoRecordController";
export * from "./FlightsManager/autoRecordStatus";
export { MissionHistorySource } from "./FlightsManager/MissionHistorySource";
export * from "./fixtureIO";
export * from "./flightDetector";
export * from "./hooks/useDataSchema";
export * from "./hooks/useDataSeries";
export * from "./hooks/useFlight";
export * from "./hooks/useManeuverFeasibility";
export * from "./hooks/useManeuverNodes";
export * from "./hooks/usePartsLive";
export * from "./hooks/useTopology";
export * from "./hooks/useValueKeys";
export * from "./hooks/useVesselDeltaV";
// `buildResourcesByFlightId`: the pure per-flightId resources lookup
// `usePartsLive` builds internally, also needed by ShipMap's built-in
// `ship-map.part-meters` contribution (a plain function of the same
// `vessel.parts` Topic payload, evaluated outside React by the contribution
// aggregator, so it can't go through the hook).
export { buildResourcesByFlightId } from "./hooks/vesselPartsAdapter";
export * from "./ListenerSet";
export { debugFlight } from "./logger";
export * from "./replaySession/ReplaySessionBanner";
export * from "./replaySession/ReplaySessionController";
export * from "./replaySession/ReplaySessionProvider";
export { registerBuiltinDerivedKeys } from "./schema/builtinDerivedKeys";
export { enrichKey, TELEMACHUS_META } from "./schema/telemachusMeta";
export { IndexedDbStore } from "./storage/IndexedDbStore";
export type { LocalStorageStoreOptions } from "./storage/LocalStorageStore";
export { LocalStorageStore } from "./storage/LocalStorageStore";
export { MemoryStore } from "./storage/MemoryStore";
export type {
  MissionMeta,
  MissionRecord,
  VideoRecordingRef,
} from "./storage/MissionStore";
export { MissionStore } from "./storage/MissionStore";
export type { Store } from "./storage/Store";
export * from "./types";
