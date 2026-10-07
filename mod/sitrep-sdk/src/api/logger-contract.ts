/**
 * Extra fields attached to one log entry.
 *
 * @category Logging and performance
 */
export interface LogContext {
  /** The id of the command or request the entry is about, so its entries can be found together. */
  requestId?: string;
  /** Who the entry is about, where that means something. */
  userId?: string;
  /** Which part of the code wrote the entry, such as an Uplink's id. */
  service?: string;
  [key: string]: unknown;
}

/**
 * A logger whose entries carry a tag, returned by `tag` on a {@link Logger}.
 * Its `debug` and `info` entries reach the console only while the tag is
 * switched on, which an operator does in the browser with
 * `localStorage.LOG_TAGS = "peer,camera"` (or `"*"` for every tag) and a
 * reload. Its `warn` and `error` entries always print. Use a tag for tracing
 * too chatty to print by default.
 *
 * @category Logging and performance
 */
export interface TaggedLogger {
  /** Detail for someone tracing a problem. Printed only while the tag is on. */
  debug(message: string, context?: LogContext): void;
  /** Something that happened and is worth a line. Printed only while the tag is on. */
  info(message: string, context?: LogContext): void;
  /** Something wrong that the code carried on past. Always printed. */
  warn(message: string, context?: LogContext): void;
  /** Something that failed, with the error that says how. Always printed. */
  error(message: string, error?: Error, context?: LogContext): void;
}

/**
 * The app's logger, reached through `logger`.
 *
 * @category Logging and performance
 */
export interface Logger {
  /** Detail for someone tracing a problem. */
  debug(message: string, context?: LogContext): void;
  /** Something that happened and is worth a line. */
  info(message: string, context?: LogContext): void;
  /** Something wrong that the code carried on past. */
  warn(message: string, context?: LogContext): void;
  /** Something that failed, with the error that says how. */
  error(message: string, error?: Error, context?: LogContext): void;
  /** Returns a {@link TaggedLogger} for the tag `name`. */
  tag(name: string): TaggedLogger;
}
