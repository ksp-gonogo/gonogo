/**
 * The logging shape the SDK asks a host for, declared here rather than imported.
 *
 * `@ksp-gonogo/logger` is `private: true` and is never published. The SDK's
 * emitted `.d.ts` used to `import type { Logger } from "@ksp-gonogo/logger"` in
 * four files and re-export `Logger` / `TaggedLogger` publicly from `api/index`,
 * so the published package declared types it could not deliver: a consumer
 * resolving them gets "Cannot find module '@ksp-gonogo/logger'". The repo's own
 * `tsconfig.base.json` sets `skipLibCheck: true`, which is exactly why this
 * survived unnoticed here and would have surfaced only in an author's tree.
 *
 * These are the HOST's logger, never a bundled copy of the app's singleton;
 * `logger.ts` and `registry.ts` both explain why that distinction is
 * load-bearing. Declaring the contract here rather than borrowing the
 * implementation's types matches that: the SDK names what it needs, and the app
 * supplies something that satisfies it.
 *
 * `logger-contract.test-d.ts` asserts the app's real `Logger` is assignable to
 * this one, so the two cannot drift apart in silence.
 */

export interface LogContext {
  requestId?: string;
  userId?: string;
  service?: string;
  [key: string]: unknown;
}

export interface TaggedLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;
  /** Returns a sub-logger whose entries are gated on the given tag. */
  tag(name: string): TaggedLogger;
}
