/**
 * Extra fields attached to one log entry, such as the id of the command it is
 * about. Useful for finding the entries of one request among the operator's
 * logs. Passed as the last argument of the {@link Logger} methods.
 *
 * @category Logging and performance
 */
export interface LogContext {
  /** The id of the command or request the entry is about, so its entries can be found together. */
  requestId?: string;
  /** An id for the operator the entry concerns, as a string; leave it out when there is none. */
  userId?: string;
  /** Which part of the code wrote the entry, such as an Uplink's id, kept on the entry for finding it later. Unlike a tag, it does not decide whether the entry prints. */
  service?: string;
  /** Any other field is kept on the entry as it is. */
  [key: string]: unknown;
}

/**
 * A logger whose entries carry a tag, returned by `tag` on a {@link Logger}.
 * Its `debug` entries reach the console only while verbose logging is on,
 * which an operator switches on in Settings under Diagnostics, or in the
 * browser with `localStorage.LOG_TAGS = "*"` and a reload. Its `info`, `warn` and `error` entries always print. Every entry,
 * tagged or not, is kept in the log buffer and sent on either way. Useful for
 * tracing too chatty to print by default.
 *
 * @category Logging and performance
 */
export interface TaggedLogger {
  /** Detail for someone tracing a problem. Printed only while the tag is on. */
  debug(message: string, context?: LogContext): void;
  /** Something that happened and is worth a line. Always printed. */
  info(message: string, context?: LogContext): void;
  /** Something wrong that the code carried on past. Always printed. */
  warn(message: string, context?: LogContext): void;
  /** Something that failed, with the error that says how. Always printed. */
  error(message: string, error?: Error, context?: LogContext): void;
}

/**
 * The app's logger, with a method for each severity. Useful for leaving a line
 * in the operator's log buffer that is also sent to the deployment's remote log
 * store, when it has one.
 * Reached through the `logger` export of this package.
 *
 * Every entry is kept in the log buffer. The browser console shows an entry
 * only at or above the level the operator sets with `localStorage.LOG_LEVEL`
 * (`debug`, `info`, `warn` or `error`, then a reload); with none set, every
 * level shows.
 *
 * @category Logging and performance
 */
export interface Logger {
  /** Detail for someone tracing a problem. Shown on the console unless `LOG_LEVEL` is set above `debug`. */
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
