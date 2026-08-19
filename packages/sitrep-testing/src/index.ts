/**
 * `@ksp-gonogo/sitrep-testing`: the test harness for a Gonogo Uplink.
 *
 * An Uplink is meant to be writable by someone outside this repository, and that
 * only holds if its TESTS are runnable by them too. They were not: every Uplink's
 * harness was assembled by importing `@ksp-gonogo/core` and
 * `@ksp-gonogo/sitrep-client` directly, both `private: true` and unpublished. 67
 * files, and the widgets were never the problem, the harness was.
 *
 * This package is published and sits ABOVE the spine, which is the only place it
 * can sit. `@ksp-gonogo/sitrep-sdk` is the leaf everything else depends on, so it
 * cannot reach `TelemetryClient` or `TimelineStore` without a cycle; the only way
 * to publish a harness from there would be to reimplement the spine over an
 * in-memory store, and a stream test running against a reimplementation of the
 * stream is not evidence about the stream. This hands over the REAL thing.
 *
 * The render half (`render`, `renderHook`, Testing Library) is NOT here: it is
 * `@ksp-gonogo/sitrep-sdk/testing`, because it needs nothing above the leaf. This
 * package re-exports it so an Uplink still has one import site for its harness.
 *
 * A typical Uplink `test/setup.ts` is now:
 *
 * ```ts
 * import { installDomStubs, installRealTestHost } from "@ksp-gonogo/sitrep-testing";
 * import { setQuantityLocale } from "@ksp-gonogo/ui-kit";
 *
 * installDomStubs();
 * installRealTestHost();
 * setQuantityLocale("en-GB");
 * ```
 */

// ── The registry and lifecycle helpers a test needs ──────────────────────────
// Re-exported from the real singletons, not reimplemented: a test that clears
// "a" registry and a widget that writes to "the" registry have to mean the same
// object, and in this workspace they do because nothing is bundled. For a
// third-party consumer the bundled copy is the one their test installs as the
// host, so both halves still agree. See tsup.config.ts.
export {
  ContributionsProvider,
  clearActionHandlers,
  clearAugments,
  clearFogRevealSources,
  clearRegistry,
  clearUplinkHandles,
  dispatchAction,
  getAugmentsForSlot,
  getComponent,
  getMapPoiProviders,
  installDomStubs,
  MockDataSource,
  PerfBudget,
  registerComponent,
  registerDataSource,
  registerStockBodies,
  resetSettingsForTests,
  SettingsProvider,
  SettingsService,
  setSetting,
  unregisterDataSource,
  useDashboardItemId,
  useWidgetBadges,
} from "@ksp-gonogo/core";
export {
  BufferedDataSource,
  DEFAULT_PROFILE_ID,
  FogMaskCache,
  FogMaskCacheProvider,
  FogMaskStore,
  MemoryStore,
} from "@ksp-gonogo/data";
// The TYPE only. Publishing the class as a value would freeze app-internal
// plumbing (transport, store, command lifecycle, loss detection) as public API,
// where every future change to it becomes someone else's breaking change. A
// test that wants a stream calls `setupStreamFixture`; one that needs to hand
// the client to something (an Uplink DataSource's `attachTelemetryClient`)
// passes `fixture.client` along without ever constructing one.
export type { TelemetryClient } from "@ksp-gonogo/sitrep-client";
// ── The spine, for a test that drives it directly ────────────────────────────
// `setupStreamFixture` above covers the common case. These are for a test that
// needs to build its own pipeline (a ReplayTransport, a second store, a clock it
// scrubs by hand).
//
// `DerivedChannelDefinition` / `DerivedGet` are deliberately NOT here. Declaring a
// derived channel is something a WIDGET does, so publishing them from a test
// harness would invite a production file to import it, which is how
// `resourceProjection.ts` briefly ended up doing exactly that. They need a home on
// `@ksp-gonogo/sitrep-sdk`, which is an open devkit gap, not a test-harness one.
export {
  activateProcessor,
  clearProcessorRuntime,
  createFakeWallClock,
  DEFAULT_SITREP_CARRIED_TOPICS,
  DYNAMIC_CARRIED_TOPIC_PREFIXES,
  dvCurrentStageResourceChannel,
  dvCurrentStageResourceMaxChannel,
  type FakeWallClock,
  getProcessorValue,
  isTopicCarried,
  mapTopic,
  StubTransport,
  setActiveTelemetryClientForTests,
  setActiveTimelineStore,
  spaceCenterStateChannel,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
  vesselStateChannel,
} from "@ksp-gonogo/sitrep-client";
// ── The render half, forwarded ───────────────────────────────────────────────
// `render`, `renderHook`, `probeText`, `installTestHost`/`resetTestHost` and the
// whole Testing Library surface. Defined in `@ksp-gonogo/sitrep-sdk/testing`,
// because it needs nothing above the leaf and so belongs where an Uplink that
// wants ONLY a render can get it without this package.
//
// Forwarded WHOLE, rather than re-exporting `@testing-library/react` again here:
// two star re-exports of the same names would be an ambiguity ESM resolves by
// silently dropping the name, and the repo's own lint rule says to reach Testing
// Library through the harness rather than directly. One source, one path.
export * from "@ksp-gonogo/sitrep-sdk/testing";
export { createTestTelemetryClient } from "./createTestTelemetryClient";
export { installRealTestHost } from "./host";
// Renders a widget the way the DASHBOARD does, not the way `render` does. See
// its own doc for the stack, and for the three wrappers it deliberately omits.
export {
  type RenderWidgetOptions,
  renderWidget,
  WidgetHost,
} from "./renderWidget";
export {
  type StreamFixture,
  type StreamFixtureOptions,
  setupStreamFixture,
} from "./streamFixture";
