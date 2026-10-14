import { __setGonogoHost, type GonogoHost } from "../api/host";

/**
 * Installs a host made of the members you pass, for a test that needs only a
 * few. Returns a function that removes it; call that in `afterEach`. Prefer
 * {@link installRealTestHost} for rendering widgets. Useful for testing a
 * widget that calls only a few members of the host.
 *
 * @param host - The members of {@link GonogoHost} the code under test calls.
 *
 * @example
 * ```ts
 * import { value } from "@ksp-gonogo/sitrep-sdk";
 * import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";
 * import { afterEach, beforeEach } from "vitest";
 *
 * let uninstall: () => void;
 * beforeEach(() => {
 *   // Only `useViewUt` is called by the code under test, so only it is supplied.
 *   uninstall = installTestHost({ useViewUt: () => value("ut", 5000) });
 * });
 * afterEach(() => uninstall());
 * ```
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
 * Removes any installed host, whichever of {@link installTestHost} or {@link
 * installRealTestHost} put it there. The function each of those returns removes
 * only the host its own call installed; this removes whatever is installed.
 * Useful for leaving no host installed between tests.
 *
 * @category Test hosts
 */
export function resetTestHost(): void {
  __setGonogoHost(undefined);
}
