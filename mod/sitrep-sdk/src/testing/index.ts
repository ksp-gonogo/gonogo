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
// PROPOSAL surface (design D-D): the concrete stateless test helpers the design
// lists for this subpath (installDomStubs, StubTransport, MockDataSource,
// createFakeWallClock) will be published REAL here once extracted from
// core/sitrep-client into a leaf-safe home. The stream fixture cannot follow them:
// it needs the real `TelemetryClient`/`TimelineStore`, which live ABOVE this leaf,
// and reimplementing them here would leave every stream test passing while
// testing the reimplementation.
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
export { probeText, render, renderHook } from "./render";
export { harnessTheme } from "./theme";
