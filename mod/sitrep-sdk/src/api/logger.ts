import { getHost } from "./host";
import type { Logger } from "./logger-contract";

/**
 * The app's logger. Entries go to the browser console, to the log buffer the
 * app keeps in the page (what its in-app log viewer and log export read), and,
 * when the deployment has a remote log store configured, there too; an Uplink
 * does nothing to turn that on. Useful for recording
 * what an Uplink's code is doing, so the operator can export the log when
 * reporting a problem. Throws when used with no app or test host installed.
 *
 * A tagged logger's `debug` entries are kept in the buffer and sent either
 * way, but reach the browser console only when the operator lists the tag in
 * `localStorage.LOG_TAGS` and reloads; its other levels always print.
 *
 * @example
 * ```ts
 * import { logger } from "@ksp-gonogo/sitrep-sdk";
 *
 * function refreshStations() {
 *   const log = logger.tag("my-uplink");
 *   log.info("Station list refreshed", { count: 3 });
 * }
 * ```
 *
 * @category Logging and performance
 * @categoryDescription Logging and performance
 * Logging from an Uplink, and keeping it cheap: the tagged logger, and the
 * performance budgets that fail a test when an event rate runs away.
 */
export const logger: Logger = new Proxy({} as Logger, {
  get: (_target, prop) => {
    const real = getHost().logger as object;
    const value = Reflect.get(real, prop);
    // Bound, because setEnabled, setLevel and setIdentity assign to `this`, and this Proxy has no set trap to pass that on.
    return typeof value === "function" ? value.bind(real) : value;
  },
});
