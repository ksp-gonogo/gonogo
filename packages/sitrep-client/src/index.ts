export const CLIENT_VERSION = "0.0.0";

export { LOSS_MARGIN, TelemetryClient } from "./client";
export type { Clock } from "./clock";
export { RealTimeClock } from "./clock";
export {
  TelemetryProvider,
  type TelemetryProviderProps,
  useTelemetryClient,
} from "./context";
export type { OrbitElements, StateVector, Vector3 } from "./kepler";
export { solve } from "./kepler";
export type { CommandStatus } from "./lifecycle";
export { mapTopic } from "./map-topic";
export { StubTransport } from "./stub-transport";
export type { ClientTimelineOptions, TimelinePoint } from "./timeline";
export { ClientTimeline } from "./timeline";
export type {
  DerivedChannelDefinition,
  DerivedGet,
  FrameToken,
  TimelineStoreOptions,
} from "./timeline-store";
export { TimelineStore } from "./timeline-store";
export type { Transport, TransportStatus } from "./transport";
export { type UseCommandResult, useCommand } from "./use-command";
export { useStream } from "./use-stream";
export { useTimelineStream } from "./use-timeline-stream";
export type {
  VesselFlightPayload,
  VesselOrbitPayload,
  VesselState,
} from "./vessel-state";
export { deriveVesselState, vesselStateChannel } from "./vessel-state";
export type {
  ViewClockConfidence,
  ViewClockMode,
  ViewClockOptions,
} from "./view-clock";
export { ViewClock } from "./view-clock";
