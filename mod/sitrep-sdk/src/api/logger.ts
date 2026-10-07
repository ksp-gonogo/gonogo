import { getHost } from "./host";
import type { Logger } from "./logger-contract";

/**
 * The app's logger. Entries go to the browser console, the app's log buffer and
 * the app's shipped logs. Throws when used with no app or test host installed.
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
