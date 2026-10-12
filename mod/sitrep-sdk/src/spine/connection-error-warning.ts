import { hasHost } from "../api/host";
import { logger } from "../api/logger";

/**
 * The warning text for an `error` frame in which the mod refused something about
 * the connection itself: one that is neither a reply to a command nor about any
 * one channel. Useful for telling a developer why a frame sent to the mod was
 * dropped. Used by `warnConnectionError`.
 *
 * Two refusals reach it: `binaryFrameNotAccepted` (a binary-lane frame sent up
 * the socket, which nothing accepts) and the `unknownVantage` refusal of a
 * `set-vantage`, whose envelope carries no requestId to correlate by.
 */
export function connectionErrorMessage(code: string, message: string): string {
  return (
    `[connection error] The mod refused something about this connection ` +
    `(${code}): ${message} This is not a reply to any command and not about ` +
    `any one channel, so nothing downstream will report it: the frame that ` +
    `caused it was dropped at the mod and whatever sent it will simply never ` +
    `be answered.`
  );
}

/**
 * Logs the connection-error warning for an `error` frame that carries neither a
 * requestId nor a topic, which would otherwise be dropped unreported. Useful for
 * telling a developer why a frame sent to the mod was refused. Used by the
 * stream client when it receives such a frame.
 *
 * Each `code` is logged once, then recorded in `warned`. Nothing is logged when
 * no host is installed.
 */
export function warnConnectionError(
  warned: Set<string>,
  code: string,
  message: string,
): void {
  if (warned.has(code)) return;
  warned.add(code);
  // The logger is host-injected and fails loud when no host is installed, the
  // ordinary state of a unit test. A diagnostic must never be the thing that
  // breaks the run it is diagnosing.
  if (!hasHost()) return;
  logger.warn(connectionErrorMessage(code, message), {
    code,
    detail: message,
  });
}
