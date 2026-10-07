import { __setGonogoHost, type GonogoHost } from "../api/host";

/**
 * Installs a host made of the members you pass, for a test that needs only a
 * few. Returns a function that removes it; call that in `afterEach`.
 * Prefer {@link installRealTestHost} for rendering widgets.
 *
 * @param host - The members of {@link GonogoHost} the code under test calls.
 *
 * @category Test hosts
 * @categoryDescription Test hosts
 * Installing the app host a widget expects, stubbed or real, before a test
 * renders it, and taking it down afterwards.
 */
export function installTestHost(host: Partial<GonogoHost>): () => void {
  __setGonogoHost(host as GonogoHost);
  return () => __setGonogoHost(undefined);
}

/**
 * Removes any installed host.
 *
 * @category Test hosts
 */
export function resetTestHost(): void {
  __setGonogoHost(undefined);
}
