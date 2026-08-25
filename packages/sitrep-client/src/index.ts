// Re-exported from the SDK, which now owns the event lane: an Uplink producing
// an event topic could not reach the spine copy. Kept here so spine-side callers
// keep their existing import site.
// Re-exported from the SDK, which now owns the clock formula: the delayed-media
// worker evaluates the same formula off-thread and could not reach a spine copy.
export type {
  ClockFormulaInputs,
  ClockFormulaSnapshot,
  CommsDelayLike,
  ConnectivityAt,
  DelayMode,
  EventOccurrence,
  EventRevealOptions,
  EventTimelineOptions,
  InFlightCommand,
  PathConnectedDuring,
  PendingEntry,
  PredictedPhase,
} from "@ksp-gonogo/sitrep-sdk";
// Carried-topic policy now lives in the SDK: an Uplink needs it at runtime.
export {
  classifyRetained,
  computeConfirmedEdgeUt,
  computeUtNowEstimate,
  currentMode,
  DEFAULT_SITREP_CARRIED_TOPICS,
  DYNAMIC_CARRIED_TOPIC_PREFIXES,
  deriveInFlight,
  EventTimeline,
  isTopicCarried,
  latchForward,
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
// The two almanac values behind CELESTIAL_FACTS the GAME cannot answer: escape
// velocity (no such member on CelestialBody) and a true anomaly solved for a
// delayed view time (Orbit.trueAnomaly is the live one).
export {
  deriveEscapeVelocity,
  derivePeriod,
  deriveTrueAnomalyDeg,
} from "./body-derivations";
// The two shared Processors and their result types. Also on the SDK's ROOT
// barrel, which is what an Uplink imports; here so app-side call sites read the
// same as every other spine name.
export {
  type BodyAtmosphere,
  bodyAtIndex,
  bodyNamed,
  CELESTIAL_FACTS,
  type CelestialBody,
  type CelestialFacts,
  deriveCelestialFacts,
} from "./celestial-facts";
export { LOSS_MARGIN, TelemetryClient } from "./client";
export type { Clock } from "./clock";
export { RealTimeClock } from "./clock";
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
export {
  type BudgetProvenance,
  DELTA_V_BUDGET,
  type DeltaVBudget,
  type DeltaVStage,
  deriveDeltaVBudget,
  normaliseStage,
} from "./delta-v-budget";
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
  type FleetSilenceRoster,
  type FleetVesselContact,
  type FleetVesselSilence,
  getLatestFleetVesselSilence,
  overdueSeconds,
  type SilenceDeadlineBasis,
  silenceByVessel,
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
export {
  type FleetVesselResource,
  fleetVesselResourceList,
  useFleetVesselResources,
} from "./fleet-resources";
export { buildFullHistoryStore, InstantClock } from "./full-history-replay";
export type { HeartbeatTrackerOptions } from "./heartbeat-tracker";
export {
  DEFAULT_KEYFRAME_INTERVAL_UT,
  HeartbeatTracker,
} from "./heartbeat-tracker";
export type {
  Anomalies,
  ArcFarEnd,
  FrameCoordinates,
  FrameInstant,
  FrameSides,
  LagrangePointName,
  LibrationAnswer,
  LibrationOffset,
  LibrationPair,
  LibrationPoint,
  LibrationRefusal,
  LibrationStationKeeping,
  OrbitElements,
  OrbitTrajectory,
  OrbitTrajectoryInput,
  PropagationHorizonLike,
  PropagationRefusal,
  ReadFrameChoice,
  ReadFrameKind,
  StateVector,
  SystemInstant,
  TrajectoryFrame,
  TrajectoryPoint,
  TrajectoryScaleConvention,
  TrajectoryWithheldReason,
  Vector3,
  WireTrajectoryArc,
} from "./kepler";
export {
  canPropagate,
  drawnFrame,
  frameCoordinatesArePulsating,
  frameInstantAt,
  frameSides,
  fromFrame,
  LAGRANGE_POINT_NAMES,
  LIBRATION_DRIFTING_UNITS,
  LIBRATION_ON_STATION_UNITS,
  LIBRATION_REFUSALS,
  lagrangePointsAt,
  librationOffsetOf,
  librationPairLabel,
  librationPairsOf,
  librationPositionsFor,
  orbitTrajectory,
  PropagationHorizonKindLike,
  pastTrack,
  READ_FRAME_KINDS,
  resolveReadFrame,
  rotateInertialToPerifocal,
  solve,
  solveAnomalies,
  solveEccentricAnomaly,
  systemInstantAt,
  TRAJECTORY_SCALE_CONVENTIONS,
  TrajectoryDerivationLike,
  TrajectoryFrameKindLike,
  TrajectoryKindLike,
  TrajectoryRefusalLike,
  toFrame,
  trajectoryFrameKindFor,
  trajectoryFrameLabel,
  useOrbitTrajectory,
} from "./kepler";
export type { CommandStatus } from "./lifecycle";
export type { GetCurrentValue, MappedCommand } from "./map-command";
export {
  hasCommandHome,
  isKnownCommandGap,
  KNOWN_COMMAND_GAPS,
  mapCommand,
} from "./map-command";
export {
  isKnownFieldPath,
  isKnownLegacyKeyGap,
  LEGACY_KEY_GAPS,
  LEGACY_KEY_HOMES,
  mapTopic,
  redirectKinematicSubtopic,
  resolveValueTopic,
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
  TransitionName,
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
  // The uncomparable-result gate lives beside the evaluator (see its own doc
  // for why it is not wired core-side like the other two processor budgets);
  // named here so `@ksp-gonogo/core` can keep all three in one place.
  PROCESSOR_UNCOMPARABLE_BUDGET,
  // Exported for the same reason `clearProcessorRuntime` above is: an Uplink's
  // own Processor test needs to point the evaluator at a store it built, and
  // reaching across the workspace boundary into this package's internals to do
  // it is worse than naming the seam.
  setActiveTimelineStore,
  setProcessorEvaluationRecorder,
  setProcessorNotificationRecorder,
  setProcessorUncomparableRecorder,
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
export { StubTransport, type WireOf } from "./stub-transport";
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
  UplinkHealthFact,
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
export { useObservedVantage } from "./use-observed-vantage";
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
  ControlStateName,
  SasModeName,
  SituationName,
  TargetKindName,
  VesselFlightPayload,
  VesselOrbitPayload,
  VesselPropulsionPayload,
  VesselState,
  WireOrbitElements,
} from "./vessel-state";
export {
  buildElements,
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
