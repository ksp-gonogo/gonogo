import { getHost } from "./host";
import type { Logger } from "./logger-contract";

/**
 * The app's single logger instance (design: `@ksp-gonogo/logger`'s `logger`
 * export is a stateful singleton, its ring buffer, session id, and
 * transports are installed on the app's instance at boot. A bundled second
 * copy would be a dead logger, console-only, never reaching Axiom or the
 * shared `exportLogs()` buffer). A `Proxy` delegates every access, including
 * `.tag(...)`: to `getHost().logger`, so the returned `TaggedLogger` is the
 * injected instance's own, and every method fails loud via `getHost()` when
 * no host is installed.
 *
 * Methods are bound to the real logger instance before being returned, not
 * just read off it: `getHost().logger.setEnabled` (etc.) returns the
 * function unbound, so an unbound call would run with `this` = the proxy's
 * dead `{}` target. Reads happen to forward through the get trap (`this.x`
 * on the real object is itself a proxied get), but there is no `set` trap,
 * an unbound method that *assigns* to `this` (`setEnabled`, `setLevel`,
 * `setIdentity`) would silently write to the dead target and never reach
 * the real logger. Binding closes that hole and would keep working even if
 * the logger ever adopts ES `#private` fields, which a bare Proxy can't
 * forward at all.
 */
export const logger: Logger = new Proxy({} as Logger, {
  get: (_target, prop) => {
    const real = getHost().logger as object;
    const value = Reflect.get(real, prop);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
