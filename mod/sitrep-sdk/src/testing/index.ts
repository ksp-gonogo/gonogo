// ---------------------------------------------------------------------------
// `@ksp-gonogo/sitrep-sdk/testing` — the test-only host injector.
//
// Under the injected-host model the app installs the real implementation at
// boot, but a unit test runs with no app. This subpath lets an author (and the
// sdk's own tests) install a fake host so the shims resolve instead of throwing
// the "no host installed" error. Self-contained — no core import, no cycle.
//
// PROPOSAL surface (design D-D): the concrete stateless test helpers the design
// lists for this subpath (installDomStubs, StubTransport, MockDataSource,
// createFakeWallClock) will be published REAL here once extracted from
// core/sitrep-client into a leaf-safe home. For now the subpath ships the host
// injector, which is the primitive the shim model actually needs in tests.
// ---------------------------------------------------------------------------

import { __setGonogoHost, type GonogoHost } from "../api/host";

/**
 * Install a (usually partial) host for the duration of a test. Returns a
 * disposer that clears it again — call it in `afterEach` so tests don't leak a
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
