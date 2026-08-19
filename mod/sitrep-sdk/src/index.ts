export * from "./__generated__/contract";
export * from "./api";
// Carried-topic POLICY: which topics the stream carries, and whether a given
// topic resolves entirely to carried inputs. Published because it decides where
// an Uplink's data actually routes, which is runtime behaviour rather than a
// test concern; it reached authors through the test harness until 2026-08-19.
export {
  isTopicCarried,
  type SubscriptionTopicResolver,
} from "./carried-channels";
export { parseServerMessage } from "./client";
// Pure delayed-command derivations. Published because delay is ambient: an
// Uplink rendering its own command surface needs the same mode/phase vocabulary
// the app's rail uses, and there is nothing app-specific in deriving it.
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
export {
  type ControlChannelHandle,
  type ControlChannelId,
  controlChannelIds,
  getControlChannel,
} from "./control-channels";
export {
  DEFAULT_SITREP_CARRIED_TOPICS,
  DYNAMIC_CARRIED_TOPIC_PREFIXES,
} from "./default-carried-topics";
export * from "./envelope";
// The discrete-occurrence timeline. It lives here rather than in the spine
// because an Uplink that PRODUCES an event topic needs the same primitive the
// spine consumes it with, and the spine is unpublished. Imports nothing, so it
// carries no spine weight into the SDK.
export type {
  ConnectivityAt,
  EventOccurrence,
  EventRevealOptions,
  EventTimelineOptions,
} from "./event-timeline";
export { EventTimeline } from "./event-timeline";
// The provider extension bag: the opaque core half of how a provider extends a
// Kernel-elected payload without a core change. The TYPED half is always in the
// provider's own package (see ./extensions.ts).
export {
  PROVIDER_EXTENSIONS_FIELD,
  type ProviderExtension,
  type ProviderExtensions,
} from "./extensions";
// The curated author-facing barrel (registration + hook shims + author types).
// PROPOSAL surface pending operator sign-off (design D-D) before first external
// publish. See ./api for why these are host-injected shims, not core re-exports.
/**
 * The read contract. An Uplink widget's `useTelemetry` answers with a `Reading`, so
 * the union and its accessors ship on the devkit surface rather than app-side.
 */
// The rate-budget class itself, not just its options type. Every new data source
// is required to register a budget and all eight Uplink test setups call
// `installTestGate`, so it has to be reachable from a published package or that
// requirement only ever applied to code inside this repo.
export { PerfBudget } from "./perf/PerfBudget";
export * from "./reading";
export * from "./timeline";
export {
  getAllKnownTopicIds,
  isTopicId,
  registerBarePrimitiveTopic,
  TOPIC_IDS,
  type TopicId,
  type TopicPayload,
  type TopicPayloadMap,
} from "./topics";
// The unit model: Value, dimensions, arithmetic, the unit table.
//
// This was namespaced as `UnitSystem` while `./value` still aliased `Value` to
// `number` for the generated contract, because two `Value`s could not sit in
// one barrel. The alias now points at the model, so the namespace has served
// its purpose and the members sit flat: a call site writes
// `import { value } from "@ksp-gonogo/sitrep-sdk"` like it does for everything
// else the SDK offers.
//
// `Vec3Of` is the exception and still comes from `./value` below: it is the
// name the generated contract puts on a unit-carrying vector, and there is no
// second spelling of it worth exporting.
export {
  assertGuardsRegistered,
  calendarRatio,
  Dimension,
  declaredUnitFor,
  displaySymbol,
  hydrate,
  isCalendarUnit,
  isValue,
  type KnownUnit,
  type KspCalendar,
  kspCalendar,
  kspYearDays,
  lookupUnit,
  namespaceOf,
  registerUnit,
  resetUnitRegistry,
  type SameDimensionAs,
  STANDARD_GRAVITY,
  STOCK_KERBIN_CALENDAR,
  setKspCalendar,
  UNIT_DEFINITIONS,
  type UnitDefinition,
  type UnitRegistration,
  type UnknownUnit,
  unitGuard,
  type Value,
  type Vector3,
  value,
  vectorMagnitude,
} from "./unit-system";
export {
  type KnownSitrepUnit,
  providerExtensionShapes,
  registerProviderExtensionShape,
  registerTopicUnits,
  registerTypeUnits,
  type SitrepUnit,
  type UnitsByField,
  unitOf,
  unitOfTypeField,
  unitsForTopic,
  unitsForType,
} from "./units";
export type { Vec3Of } from "./value";
export { SDK_VERSION } from "./version.generated";
// The pure view-clock formula. Shared by the spine's `ViewClock` and by the
// delayed-media worker, which evaluates it off-thread against a serialisable
// snapshot: one implementation, never a fork.
export type {
  ClockFormulaInputs,
  ClockFormulaSnapshot,
} from "./view-clock-formula";
export {
  computeConfirmedEdgeUt,
  computeUtNowEstimate,
} from "./view-clock-formula";
export {
  hydratePayload,
  wrapTopicPayload,
  wrapTypePayload,
} from "./wrap-units";
