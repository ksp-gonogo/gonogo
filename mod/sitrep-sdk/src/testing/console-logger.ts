import type { Logger } from "../api/logger-contract";

/**
 * A {@link Logger} that writes every level straight to `console`, as a test
 * host installs it. `tag()` returns the same logger, so tagged entries are
 * always shown.
 *
 * @category Test doubles
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
