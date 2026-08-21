// Single import surface for the Processor primitive (contribution-slots-spec
// §14): the definition/hook/types live in the sitrep-client spine (importing
// core would cycle); re-exported here so client code has one `@ksp-gonogo/core`
// import. The bare `./processorPerfBudget` import is for its side effect: it
// wires the evaluator's recorder seam to a real core-side PerfBudget at load.
export {
  type Dep,
  defineProcessor,
  type ProcessorHandle,
  type ResolvedDeps,
  useProcessor,
} from "@ksp-gonogo/sitrep-client";
// Re-exported, not owned. Both moved to `@ksp-gonogo/sitrep-sdk/testing` so an
// Uplink can obtain them: `installDomStubs` imports nothing, and `MockDataSource`
// names four types and no behaviour, so neither had anything keeping it in an
// unpublished package that 9 and 15 Uplink test files respectively had to import.
// Kept on this barrel so core's own consumers (the app and components setup files)
// did not have to move with them.
export {
  installDomStubs,
  MockDataSource,
  type MockDataSourceOptions,
} from "@ksp-gonogo/sitrep-sdk/testing";
export * from "./AugmentSlot";
export * from "./actionGroups";
export * from "./actions/dispatcher";
export * from "./augments";
export * from "./bodies";
export * from "./calc";
export * from "./chromeProviders";
export * from "./contexts/DashboardItemContext";
export * from "./contexts/ScreenContext";
export * from "./contexts/WidgetMetaContext";
export * from "./contributions";
export {
  ContributionsProvider,
  useContributions,
  useContributionsBySlotId,
} from "./contributionsRuntime";
export * from "./declarations";
export * from "./fog";
export * from "./fogReveal";
export * from "./hooks/defineTopicManifest";
export * from "./hooks/useActionInput";
export * from "./hooks/useDataSourceSubscription";
export * from "./hooks/useDataSources";
export * from "./hooks/useDataStreamStatus";
export * from "./hooks/useGameContext";
export * from "./hooks/useOrbitElements";
export * from "./hooks/useTelemetry";
export * from "./hooks/useTelemetryHostStatus";
export * from "./hooks/useTouchDevice";
export * from "./hooks/useUplinkHealthFor";
export { useWidgetBadges } from "./hooks/useWidgetBadges";
export * from "./hooks/useWidgetStreamStatus";
// ErrorBoundary stays in core (React-specific). The rest of the
// logger surface: `logger`, `AxiomTransport`, `tagRegistry`, types,
// debugPeer, handleError: moved to `@ksp-gonogo/logger` so Node services
// can consume it without dragging in core's browser-leaning tree.
export { ErrorBoundary } from "./logger/ErrorBoundary";
export * from "./mapPoi";
export * from "./orbital";
export * from "./perf/PerfBudget";
export {
  PROCESSOR_EVAL_BUDGET,
  PROCESSOR_NOTIFY_BUDGET,
} from "./processorPerfBudget";
export * from "./registry";
export * from "./rss-bodies";
export * from "./safeRandomUuid";
export * from "./schemas/orbit";
export * from "./schemas/telemachus";
export * from "./schemas/vessel-parts";
export * from "./searchTags";
export * from "./settings/gameHost";
export * from "./settings/registry";
export * from "./settings/SettingsContext";
export * from "./settings/SettingsService";
export * from "./settings/store";
export * from "./settingsTabs";
export * from "./stock-bodies";
export * from "./theme";
export * from "./types";
export * from "./uplinkClients";
export * from "./uplinkHandles";
export * from "./uplinkVersionCompat";
export * from "./utils/format";
export * from "./utils/math";
export * from "./version/compare";
export * from "./version/runtime";
export * from "./widgetSize";
