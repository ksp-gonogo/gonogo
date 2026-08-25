import type { Logger } from "../api/logger-contract";

/**
 * The logger a test host installs: every level straight to `console`.
 *
 * It is NOT a stand-in for `@ksp-gonogo/logger`'s singleton and could not be. That
 * singleton carries the app's ring buffer, session id and Axiom transport, it is
 * `private: true`, and an Uplink author cannot install it, so a harness that
 * published one would be publishing a package nobody can obtain.
 *
 * Which is fine, because there is nothing to be faithful to here. The reason a test
 * host must not simply forward `api/logger.ts`'s export is sharper than fidelity:
 * that export is a Proxy over `getHost().logger`, so installing it AS the host's
 * logger makes `getHost().logger.info(...)` read the Proxy, which reads
 * `getHost().logger`, which is the Proxy. Thirty Uplink suites died at once with
 * `RangeError: Maximum call stack size exceeded` pointing at the Proxy's own `get`
 * trap. A logger that logs is the whole requirement, and `console` meets it.
 *
 * `tag()` returns this same object rather than a gated sub-logger: verbose tracing
 * is a delivery concern of the real logger's transports, and swallowing a tagged
 * line in a test would hide the one thing the author is reading.
 */
export const consoleLogger: Logger = {
  debug: (message, context) => {
    console.debug(message, context ?? "");
  },
  info: (message, context) => {
    console.info(message, context ?? "");
  },
  warn: (message, context) => {
    console.warn(message, context ?? "");
  },
  error: (message, error, context) => {
    console.error(message, error ?? "", context ?? "");
  },
  tag: () => consoleLogger,
};
