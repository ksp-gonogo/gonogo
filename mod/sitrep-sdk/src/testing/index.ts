// ---------------------------------------------------------------------------
// `@ksp-gonogo/sitrep-sdk/testing`: the test-only host injector.
//
// Under the injected-host model the app installs the real implementation at
// boot, but a unit test runs with no app. This subpath lets an author (and the
// sdk's own tests) install a fake host so the shims resolve instead of throwing
// the "no host installed" error. Self-contained: no core import, no cycle.
//
// It also ships the RENDER harness (2026-08-18): `render`/`renderHook` with the
// kit's theme always mounted, plus Testing Library re-exported unchanged. Those
// lived in `@ksp-gonogo/test-utils` until now, which is `private: true`, so 56
// Uplink client files were importing a package an outside author cannot obtain.
// Testing Library and styled-components are OPTIONAL peers and this is a separate
// entry from the root barrel, so a runtime consumer never resolves any of it.
//
// The spine helpers and the registry helpers are NOT here and will not be: they
// need `core` / `sitrep-client`, which are above this leaf, so they live in
// `@ksp-gonogo/sitrep-testing` instead. An earlier revision of this comment listed
// them by name as a future proposal for this subpath, and that cost more than it
// was worth: greps of the sdk for those symbols hit the prose and read as though
// the subpath already exported them. The rule, with no names to mis-grep: if a
// helper needs anything above this package, it belongs in `sitrep-testing`.
// ---------------------------------------------------------------------------

import { __setGonogoHost, type GonogoHost } from "../api/host";

/**
 * Install a (usually partial) host for the duration of a test. Returns a
 * disposer that clears it again: call it in `afterEach` so tests don't leak a
 * host into each other. A partial host is allowed: only wire the members the
 * code under test actually calls.
 */
export function installTestHost(host: Partial<GonogoHost>): () => void {
  __setGonogoHost(host as GonogoHost);
  return () => __setGonogoHost(undefined);
}

/** Clear any installed host. */
export function resetTestHost(): void {
  __setGonogoHost(undefined);
}

// Everything else Testing Library offers (`screen`, `waitFor`, `within`, `act`,
// `fireEvent`, `cleanup`, …) passes straight through, so this subpath is a
// drop-in for the import source. The named exports above take precedence, so
// `render`/`renderHook` resolve to the themed versions.
export * from "@testing-library/react";
// The registry-observation half. `getAugmentsForSlot` is on the root barrel next to
// `registerAugment`, since reading a slot's augments is something a widget does too;
// `clearAugments` is test-only and so lives here rather than on the author surface.
// Both resolve through the host, which is the point: a test observes the same
// registry the shim wrote to, instead of reaching for ui-kit's copy and relying on
// the two happening to be the same object.
export { clearAugments, getAugmentsForSlot } from "../api/index";
// The transport double. It named nothing above this leaf (wire messages, `Meta`,
// `wrapTopicPayload`), so its old home in the unpublished `@ksp-gonogo/sitrep-client`
// was the only reason an Uplink's `sentCommands`/`isSubscribed` assertions needed a
// package an outside author cannot install.
// ── The spine, for a test that drives it directly ───────────────────────────
//
// `setupStreamFixture` covers the common case and should be reached for first.
// These are for a test that builds its own pipeline: a second store, a clock it
// scrubs by hand, a processor it activates without a provider.
//
// Forwarded from `../spine` rather than re-exported from the root barrel, because
// the root barrel is the AUTHOR surface and none of this belongs on it: nothing
// about writing an Uplink needs `TimelineStore`, and publishing it there would
// freeze the store's internals as third-party API. A test is a different audience
// from a widget, and this subpath is where that difference is expressed.
export {
  activateProcessor,
  clearProcessorRuntime,
  type DerivedGet,
  getProcessorValue,
  mapTopic,
  setActiveTelemetryClientForTests,
  setActiveTimelineStore,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "../spine";
export { createTestTelemetryClient } from "./create-test-telemetry-client";
export { createFakeWallClock, type FakeWallClock } from "./fake-wall-clock";
export { probeText, render, renderHook } from "./render";
// The stream fixture: a real `TelemetryProvider` over a real
// `TelemetryClient`/`TimelineStore`/`ViewClock`, fed by hand-authored emissions.
// It sits here rather than a package above because the spine it drives is in this
// package now, so there is no reimplementation involved in publishing it.
export {
  type StreamFixture,
  type StreamFixtureOptions,
  setupStreamFixture,
} from "./stream-fixture";
export {
  makeMeta,
  type SentCommand,
  StubTransport,
} from "./stub-transport";
export { harnessTheme } from "./theme";
