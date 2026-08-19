// Re-exported from the SDK, which now owns the event lane: an Uplink producing
// an event topic could not reach the spine copy. Kept here so spine-side callers
// keep their existing import site.
// Re-exported from the SDK, which now owns the clock formula: the delayed-media
// worker evaluates the same formula off-thread and could not reach a spine copy.
export type {
  ClockFormulaInputs,
  ClockFormulaSnapshot,
  ConnectivityAt,
  EventOccurrence,
  EventRevealOptions,
  EventTimelineOptions,
} from "@ksp-gonogo/sitrep-sdk";
// Carried-topic policy now lives in the SDK: an Uplink needs it at runtime.
export {
  computeConfirmedEdgeUt,
  computeUtNowEstimate,
  DEFAULT_SITREP_CARRIED_TOPICS,
  DYNAMIC_CARRIED_TOPIC_PREFIXES,
  EventTimeline,
  isTopicCarried,
} from "@ksp-gonogo/sitrep-sdk";
// Generic delayed-media infrastructure (buffer, per-frame pipeline, per-camera
// sharing). Now published as `@ksp-gonogo/sitrep-sdk/media`; re-exported here so
// spine-side call sites keep their import site.
export * from "@ksp-gonogo/sitrep-sdk/media";
export {
  type AutoCommandOptions,
  type AutoCommandStatus,
  type AutoDispatchDecision,
  decideAutoDispatch,
  useAutoCommand,
} from "./auto-command";
export { LOSS_MARGIN, TelemetryClient } from "./client";
export type { Clock } from "./clock";
export { RealTimeClock } from "./clock";
export type {
  CommsDelayLike,
  DelayMode,
  InFlightCommand,
  PathConnectedDuring,
  PendingEntry,
  PredictedPhase,
} from "./command-delay";
export {
  classifyRetained,
  currentMode,
  deriveInFlight,
  latchForward,
} from "./command-delay";
export type { CommsLinkLike } from "./connectivity-history";
export { ConnectivityHistory } from "./connectivity-history";
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
  subscribeActiveTelemetryClient,
  TelemetryProvider,
  type TelemetryProviderProps,
  useActiveTelemetryClient,
  useCarriedChannels,
  useCarriedChannelsOptional,
  useStreamRecorder,
  useTelemetryClient,
  useTelemetryClientOptional,
  useTelemetryStore,
  useTelemetryStoreOptional,
  useUtNow,
  useViewClock,
  useViewClockOptional,
  useViewUt,
  type ViewClockView,
} from "./context";
export type { ContributedChannelConflict } from "./contributed-channels";
export {
  clearContributedDerivedChannels,
  contributeDerivedChannel,
  getContributedChannelConflicts,
  getContributedDerivedChannels,
} from "./contributed-channels";
export type {
  ControlExpectation,
  DeriveExpectationsArgs,
  ExpectationPhase,
  FieldObservation,
} from "./control-expectation";
export { deriveExpectations } from "./control-expectation";
export type {
  ControlRange,
  ControlSample,
  DerivedStrip,
  DeriveStripArgs,
  LoggedSample,
} from "./control-stream-model";
export {
  commandedAt,
  DEVIATION_EPSILON,
  deriveStrip,
  hasDeviation,
  MIN_DELAY_SECONDS,
  normalize01,
} from "./control-stream-model";
export {
  type AgedScienceCredit,
  type ReputationLossEvent,
  reputationLossTopic,
  type ScienceCreditEvent,
  scienceCreditTopic,
  useReputationLossEvents,
  useRevealedScience,
  useScienceCredit,
  useStickyVesselGuids,
} from "./currency-events";
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
export {
  type ContactPhase,
  contactPhase,
  type FleetVesselContact,
  type FleetVesselSilence,
  getLatestFleetVesselSilence,
  overdueSeconds,
  type SilenceDeadlineBasis,
  useFleetVesselContact,
  useFleetVesselSilence,
} from "./fleet-contact";
export {
  type FleetVesselLink,
  useFleetVesselLink,
} from "./fleet-link";
export {
  propagateVesselOrbit,
  useFleetVesselPosition,
} from "./fleet-position";
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
export { solve, solveAnomalies, solveEccentricAnomaly } from "./kepler";
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
  isKnownFieldPath,
  isKnownTelemachusGap,
  mapTopic,
  redirectKinematicSubtopic,
  TELEMACHUS_CLEAN_HOMES,
  TELEMACHUS_KNOWN_GAPS,
} from "./map-topic";
export type {
  NeverReckonable,
  UnmodelledReading,
} from "./never-reckonable";
export { isNeverReckonable, NEVER_RECKONABLE } from "./never-reckonable";
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
export {
  activateProcessor,
  // Test-only: resets the shared Processor runtime cache (evaluated values +
  // frame-generation bookkeeping). Needed by any test suite that mounts
  // MULTIPLE independent TelemetryProvider/TimelineStore fixtures across
  // sequential `it()` blocks while varying the data fed to the SAME
  // globally-registered Processor id: each fresh store's frame generation
  // counter restarts at 0, so a later fixture's `beginFrame()` can coincide
  // with an earlier fixture's `lastFrameGeneration`, and `evaluate()` then
  // (wrongly) treats the new store's frame as "already fresh," permanently
  // serving the earlier fixture's stale computed value. This was previously
  // sitrep-client-internal only (its own `use-processor.test.tsx` /
  // `processorEvaluator.test.ts` import it by relative path); exported here
  // so a consuming package's own Processor tests (e.g. an Uplink's) can
  // reset between cases the same way, without reaching into this package's
  // internals across the workspace boundary.
  clearProcessorRuntime,
  evaluateActiveProcessors,
  getProcessorValue,
  // Exported for the same reason `clearProcessorRuntime` above is: an Uplink's
  // own Processor test needs to point the evaluator at a store it built, and
  // reaching across the workspace boundary into this package's internals to do
  // it is worse than naming the seam.
  setActiveTimelineStore,
  setProcessorEvaluationRecorder,
} from "./processorEvaluator";
export {
  type AnyProcessorDefinition,
  clearProcessors,
  type Dep,
  defineProcessor,
  getAllProcessors,
  getProcessor,
  type ProcessorDefinition,
  type ProcessorFrame,
  type ProcessorHandle,
  type ReadingDep,
  type ResolvedDeps,
} from "./processors";
export type {
  BuildPatchesInput,
  BuildPatchesOptions,
  ManeuverBurn,
  ManeuverPreview,
  OrbitPatch,
  OsculatingElements,
  PatchEncounter,
} from "./propagation";
export {
  buildOrbitPatches,
  orbitalPeriod,
  previewManeuver,
  rvToElements,
  STANDARD_GRAVITY,
} from "./propagation";
export type {
  Reading,
  ReckonerFor,
  Reckoning,
  ReckoningBasis,
  StaleGrade,
} from "./reading";
/**
 * Re-exported from `./reading`, which re-exports them from `@ksp-gonogo/sitrep-sdk`.
 * They ended up on the devkit surface because every consumer of `useTelemetry` needs
 * them and an Uplink client cannot import this package.
 */
/**
 * The fact-versus-verdict accessors are gone: whether a value is a standing fact or a
 * decaying verdict is context-dependent rather than a property of the field, so a
 * shared helper forced one answer on every reader. Each widget branches on the arms
 * and decides for itself. What remains answers questions that have one answer.
 */
export { observedAt, readingFrom, withoutReckoning } from "./reading";
export type { ReckonerConflict } from "./reckoners";
export {
  clearReckoners,
  getReckoner,
  getReckonerConflicts,
  registerReckoner,
} from "./reckoners";
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
export {
  type CommandOutputToken,
  META_VANTAGE,
  type UseCommandResult,
  useCommand,
} from "./use-command";
export {
  type ControlStream,
  type ControlStreamOptions,
  useControlStream,
} from "./use-control-stream";
export {
  type LateTelemetrySubscribe,
  type Unsubscribe,
  useLateTelemetrySubscribe,
} from "./use-late-telemetry-subscribe";
export { useProcessor } from "./use-processor";
export type {
  PendingUplinkQueueLike,
  UseRouteCommandsResult,
} from "./use-route-commands";
export { useRouteCommands } from "./use-route-commands";
export { useSelectedVantage } from "./use-selected-vantage";
export { useLatestValue, useStream } from "./use-stream";
export { useStreamEvent } from "./use-stream-event";
export { useStreamStatus } from "./use-stream-status";
export { useTimelineStream } from "./use-timeline-stream";
export { CLIENT_VERSION } from "./version.generated";
export type {
  ActionGroupStatePayload,
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
