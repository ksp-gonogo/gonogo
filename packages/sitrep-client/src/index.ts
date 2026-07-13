export const CLIENT_VERSION = "0.0.0";

export { isTopicCarried } from "./carried-channels";
export { LOSS_MARGIN, TelemetryClient } from "./client";
export type { Clock } from "./clock";
export { RealTimeClock } from "./clock";
export {
  dispatchActiveCommand,
  getActiveCarriedChannels,
  getActiveTelemetryClient,
  getContractsActive,
  getValue,
  getVesselIdentity,
  getVesselOrbit,
  getVesselState,
  getVesselTarget,
  getViewUt,
  getWarpState,
  onActiveTimelineFrame,
  PRODUCTION_DERIVED_CHANNELS,
  sampleActiveTopic,
  setActiveCarriedChannelsForTests,
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  setActiveViewClockForTests,
  TelemetryProvider,
  type TelemetryProviderProps,
  useCarriedChannels,
  useCarriedChannelsOptional,
  useStreamRecorder,
  useTelemetryClient,
  useTelemetryClientOptional,
  useTelemetryStore,
  useTelemetryStoreOptional,
  useViewClock,
  useViewClockOptional,
  useViewUt,
  type ViewClockView,
} from "./context";
export { DEFAULT_SITREP_CARRIED_TOPICS } from "./default-carried-topics";
export {
  COMMS_DELAY_TOPIC,
  DelayAuthority,
  type DelaySubscribable,
} from "./delay-authority";
export type { DvLegacyScalars } from "./dv-legacy-scalars";
export {
  deriveDvLegacyScalars,
  dvLegacyScalarsChannel,
} from "./dv-legacy-scalars";
export type { ResourceAmountMap } from "./dv-stage-resources";
export {
  deriveCurrentStageResourceCurrent,
  deriveCurrentStageResourceMax,
  dvCurrentStageResourceChannel,
  dvCurrentStageResourceMaxChannel,
} from "./dv-stage-resources";
export type { FakeWallClock } from "./fake-wall-clock";
export { createFakeWallClock } from "./fake-wall-clock";
export { buildFullHistoryStore, InstantClock } from "./full-history-replay";
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
export type {
  LegacyManeuverNode,
  ManeuverNodeWirePayload,
  VesselManeuverLegacyState,
  VesselManeuverPayload,
} from "./maneuver-legacy";
export {
  deriveVesselManeuverLegacy,
  mapManeuverNode,
  vesselManeuverLegacyChannel,
} from "./maneuver-legacy";
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
export type {
  ImpactPoint,
  LegacyOrbitPatch,
  OrbitPatchWirePayload,
  PredictionRef,
} from "./orbit-patches";
export {
  findImpactPoint,
  mapOrbitPatch,
  ROTATION_PERIOD_SECONDS,
} from "./orbit-patches";
export type {
  BuildPatchesInput,
  BuildPatchesOptions,
  ClosestApproach,
  ClosestApproachOptions,
  ManeuverBurn,
  ManeuverPreview,
  OrbitPatch,
  OsculatingElements,
  PatchEncounter,
} from "./propagation";
export {
  buildOrbitPatches,
  closestApproach,
  orbitalPeriod,
  previewManeuver,
  rvToElements,
  STANDARD_GRAVITY,
} from "./propagation";
export type { StreamRecorderOptions } from "./replay-recorder";
export { StreamRecorder } from "./replay-recorder";
export type { ReplayFixture, ReplayTransportOptions } from "./replay-transport";
export { ReplayTransport } from "./replay-transport";
export type { SpaceCenterState } from "./space-center-state";
export {
  deriveSpaceCenterState,
  spaceCenterStateChannel,
} from "./space-center-state";
export type { StreamStatusValue } from "./stream-status";
export { worstStatus } from "./stream-status";
export { StubTransport } from "./stub-transport";
export type { SystemState } from "./system-state";
export { deriveSystemState, systemStateChannel } from "./system-state";
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
export type {
  SystemUplinkHealth,
  UplinkHealthEntry,
  UplinkHealthStateName,
} from "./uplink-health";
export {
  deriveSystemUplinkHealth,
  systemUplinkHealthChannel,
} from "./uplink-health";
export { useCertainty } from "./use-certainty";
export { type UseCommandResult, useCommand } from "./use-command";
export { useStream } from "./use-stream";
export { useStreamEvent } from "./use-stream-event";
export { useStreamStatus } from "./use-stream-status";
export { useTimelineStream } from "./use-timeline-stream";
export type {
  VesselFlightPayload,
  VesselOrbitPayload,
  VesselPropulsionPayload,
  VesselState,
} from "./vessel-state";
export {
  collapseControlStateLevel,
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
