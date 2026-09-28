/**
 * Extra fields attached to one log entry.
 *
 * @category Logging and performance
 */
export interface LogContext {
  requestId?: string;
  userId?: string;
  service?: string;
  [key: string]: unknown;
}

/**
 * A logger whose entries carry a tag, returned by `Logger.tag`. A tagged entry
 * reaches the console only while its tag is switched on.
 *
 * @category Logging and performance
 */
export interface TaggedLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;
}

/**
 * The app's logger, reached through `logger`.
 *
 * @category Logging and performance
 */
export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;
  /** Returns a sub-logger whose entries are gated on the given tag. */
  tag(name: string): TaggedLogger;
}
