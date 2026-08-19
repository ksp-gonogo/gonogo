import { __setGonogoHost, type GonogoHost } from "../api/host";

/**
 * Install a (usually partial) host for the duration of a test. Returns a
 * disposer that clears it again: call it in `afterEach` so tests don't leak a
 * host into each other. A partial host is allowed: only wire the members the
 * code under test actually calls.
 *
 * Its own module rather than `./index.ts`'s body, so `./install-real-test-host.ts`
 * can reach it without importing the barrel that re-exports it.
 */
export function installTestHost(host: Partial<GonogoHost>): () => void {
  __setGonogoHost(host as GonogoHost);
  return () => __setGonogoHost(undefined);
}

/** Clear any installed host. */
export function resetTestHost(): void {
  __setGonogoHost(undefined);
}
