export const CLIENT_VERSION = "0.0.0";

export { isTopicCarried } from "./carried-channels";
export { LOSS_MARGIN, TelemetryClient } from "./client";
export type { Clock } from "./clock";
export { RealTimeClock } from "./clock";
export {
  TelemetryProvider,
  type TelemetryProviderProps,
  useCarriedChannels,
  useCarriedChannelsOptional,
  useTelemetryClient,
  useTelemetryClientOptional,
  useTelemetryStore,
  useTelemetryStoreOptional,
  useViewClock,
  useViewClockOptional,
} from "./context";
export type { FakeWallClock } from "./fake-wall-clock";
export { createFakeWallClock } from "./fake-wall-clock";
export type { HeartbeatTrackerOptions } from "./heartbeat-tracker";
export {
  DEFAULT_KEYFRAME_INTERVAL_UT,
  HeartbeatTracker,
} from "./heartbeat-tracker";
export type {
  Anomalies,
  OrbitElements,
  StateVector,
  Vector3,
} from "./kepler";
export { solve, solveAnomalies } from "./kepler";
export type { CommandStatus } from "./lifecycle";
export type { GetCurrentValue, MappedCommand } from "./map-command";
export {
  hasCommandHome,
  isKnownCommandGap,
  KNOWN_COMMAND_GAPS,
  mapCommand,
} from "./map-command";
export {
  isKnownTelemachusGap,
  mapTopic,
  redirectKinematicSubtopic,
  TELEMACHUS_CLEAN_HOMES,
  TELEMACHUS_KNOWN_GAPS,
} from "./map-topic";
export type { ReplayFixture, ReplayTransportOptions } from "./replay-transport";
export { ReplayTransport } from "./replay-transport";
export type { StreamStatusValue } from "./stream-status";
export { worstStatus } from "./stream-status";
export { StubTransport } from "./stub-transport";
export type { ClientTimelineOptions, TimelinePoint } from "./timeline";
export { ClientTimeline } from "./timeline";
export type {
  DerivedChannelDefinition,
  DerivedGet,
  FrameToken,
  TimelineStoreOptions,
} from "./timeline-store";
export { lerpPayload, TimelineStore } from "./timeline-store";
export type { Transport, TransportStatus } from "./transport";
export { useCertainty } from "./use-certainty";
export { type UseCommandResult, useCommand } from "./use-command";
export { useStream } from "./use-stream";
export { useStreamStatus } from "./use-stream-status";
export { useTimelineStream } from "./use-timeline-stream";
export type {
  VesselFlightPayload,
  VesselOrbitPayload,
  VesselState,
} from "./vessel-state";
export {
  deriveVesselState,
  deriveVesselStateStatus,
  vesselStateChannel,
} from "./vessel-state";
export type {
  Certainty,
  ViewClockConfidence,
  ViewClockMode,
  ViewClockOptions,
} from "./view-clock";
export { ViewClock } from "./view-clock";
export type {
  StreamFrameInfo,
  WebSocketCtor,
  WebSocketLike,
  WebSocketTransportOptions,
} from "./websocket-transport";
export { WebSocketTransport } from "./websocket-transport";
