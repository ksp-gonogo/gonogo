export * from "./__generated__/contract";
export * from "./api";
// The HOST's logger, not `@ksp-gonogo/logger`'s singleton (a bundled second copy of
// that is a dead logger: console-only, never reaching Axiom or the shared
// `exportLogs()` buffer). Published from the root barrel and NOT from `./api`,
// deliberately: `api/index.ts` says why it is absent there, and re-exporting it
// through that barrel is what made `perf/PerfBudget -> api/index ->
// api/settings/SettingsService -> perf/PerfBudget` a cycle.
//
// Published at all because `@ksp-gonogo/ui-kit` is published and does real work:
// the contribution aggregation isolates a throwing contribution and has to say
// which one threw. Its only alternative was a bare `console.warn`, which is
// invisible to Axiom, so the one place an Uplink author's broken `compute` gets
// reported would have been the place nobody can read after the fact.
export { logger } from "./api/logger";
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
// The compat numbers a `gonogo-uplink.json` is gated on. Published here because
// an Uplink's build has to write them and could not read any of them.
export {
  CONTRACT_MAJOR,
  CONTRACT_MINOR,
  EXTENSION_API_VERSION,
} from "./compat-versions";
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
// Ordinal->name tables and closed name unions for the contract's enums. On the
// root barrel rather than in the spine because an Uplink needs them as much as
// the app does: KSP's ResourceFlowMode reaches the Kerbalism Uplink and its
// PartCategories reach ShipMap, and an Uplink that had to transcribe the member
// set beside its own switch is back to the defect these tables exist to end.
// Derived from the generated contract and nothing else, so they carry no spine
// weight into the SDK.
export { namesByValue, namesOf } from "./enum-names";
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
// The buffered-recording subsystem: wraps a live `DataSource`, persists every
// sample into a `Store` keyed by inferred flight, and answers columnar range
// queries. Moved down from `@ksp-gonogo/data` on 2026-08-19: an Uplink's tests
// build one to assert what its widgets read, and `data` is `private: true`, so
// the harness they needed was unbuildable outside this repo. Its transitive
// imports were this package and itself all along.
export type { KeyEnricher } from "./flight/BufferedDataSource";
export { BufferedDataSource } from "./flight/BufferedDataSource";
export { DataSourceWrapper } from "./flight/DataSourceWrapper";
export { debugFlight } from "./flight/debugFlight";
export type { DerivedKeyDef } from "./flight/derive";
export {
  clearDerivedKeys,
  getDerivedKeys,
  registerDerivedKey,
} from "./flight/derive";
export type {
  ExportFlightOptions,
  FlightChapter,
  FlightFixture,
} from "./flight/fixtureIO";
export {
  exportFlightToFixture,
  FLIGHT_FIXTURE_FORMAT,
  fixtureDurationMs,
  importFixtureToStore,
  isFlightFixture,
} from "./flight/fixtureIO";
export {
  DEFAULT_KEEP_COUNT,
  getKeepCount,
  setKeepCount,
  subscribeAutoDelete,
} from "./flight/flightAutoDelete";
export type {
  DetectorDecision,
  DetectorInput,
} from "./flight/flightDetector";
export { FlightDetector } from "./flight/flightDetector";
export { KeyedListenerSet, ListenerSet } from "./flight/ListenerSet";
export type { LocalStorageStoreOptions } from "./flight/storage/LocalStorageStore";
export { LocalStorageStore } from "./flight/storage/LocalStorageStore";
export { MemoryStore } from "./flight/storage/MemoryStore";
export type { FlightStore } from "./flight/storage/Store";
export { FLIGHTS_DESC } from "./flight/storage/Store";
export type {
  DataKeyMeta,
  FlightChapterRecord,
  FlightCrashOutcome,
  FlightOutcome,
  FlightRecord,
  FlightRecoveryOutcome,
  MissionMeta,
  Sample,
  SeriesRange,
  UnitHint,
} from "./flight/types";
export * from "./ksp-enum-names";
// The magnitude unwrap, beside `Value` because that is what it unwraps. Moved
// down from ui-kit on 2026-08-25: ui-kit depends on this package, so while it
// lived there nothing here could reach it without a cycle and two spine files
// carried their own diverging copies. `magnitude.ts`'s own doc says what that
// cost. ui-kit re-exports these three, so no call site moved.
export {
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
} from "./magnitude";
// What a burn's three delta-v slots are called in the basis the burn declares.
// Published for the reason `enum-names` above is: the slots are positional and
// the field names are the stock basis's, so an Uplink planner working in the
// Frenet trihedron needs these words and had been transcribing them.
export {
  type ManeuverBasisLabels,
  maneuverBasisLabels,
} from "./maneuver-basis";
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
// ---------------------------------------------------------------------------
// SHARED PROCESSORS: the handles, their result types, and the pure derivations
// behind them.
//
// Published from the ROOT barrel rather than only from `./spine`, because the
// root barrel is the whole of what an Uplink may import (docs/uplink-isolation.md)
// and a Processor nobody outside this repo can name is not shared, whatever
// `registerProcessor`'s owner stamp says. The machinery stays where it was:
// `defineProcessor`, the evaluator and `TimelineStore` are still spine-only, and
// `useProcessor` reaches the evaluator through the host shim above.
//
// A handle here is a DECLARATION, not a subscription. Importing the SDK registers
// the definition; nothing evaluates until a `useProcessor` or a contribution dep
// activates it.
// ---------------------------------------------------------------------------
export {
  type BodyAtmosphere,
  bodyAtIndex,
  bodyNamed,
  CELESTIAL_FACTS,
  type CelestialBody,
  type CelestialFacts,
  deriveCelestialFacts,
} from "./spine/celestial-facts";
export {
  type BudgetProvenance,
  DELTA_V_BUDGET,
  type DeltaVBudget,
  type DeltaVStage,
  deriveDeltaVBudget,
  normaliseStage,
} from "./spine/delta-v-budget";
// The CONTRACT half of the Processor primitive, and the only route by which a
// Processor one Uplink implements can be consumed, typed, by another. Published
// alongside the handle type it returns; `defineProcessor` itself stays
// spine-only, because declaring a processor needs the evaluator and declaring
// its contract does not. See `defineProcessorContract`'s own doc for why a
// declaration-merged registry keyed by id cannot do this job.
export {
  defineProcessorContract,
  type ProcessorHandle,
} from "./spine/processors";
// The shape of `system.uplinkHealth`, so an Uplink can read the roster it is
// itself reported on. Published because health is where an Uplink says what it
// depends on and whether that dependency is usable, which is the sort of thing a
// widget wants to badge beside the numbers it draws. Types only: the roster is
// read with `useStream("system.uplinkHealth")` like any other channel, and
// deriving it is the spine's job rather than an author's.
export type {
  SystemUplinkHealth,
  UplinkHealthEntry,
  UplinkHealthFact,
  UplinkHealthStateName,
} from "./spine/uplink-health";
export * from "./timeline";
export {
  DERIVED_CHANNEL_IDS,
  type DerivedChannelId,
  getAllKnownTopicIds,
  isDerivedChannelId,
  isTopicId,
  isWidgetChannelId,
  registerBarePrimitiveTopic,
  TOPIC_IDS,
  type TopicId,
  type TopicPayload,
  type TopicPayloadMap,
  type WidgetChannelId,
  type WidgetFieldPath,
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
  affineVectorUnitFor,
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
  type PointUnit,
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
