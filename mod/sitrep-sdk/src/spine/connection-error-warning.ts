import { hasHost } from "../api/host";
import { logger } from "../api/logger";

/**
 * The mod refused something about the CONNECTION itself: not a reply to any
 * command, and not about any one channel.
 *
 * Third sibling of `warnChannelError` and `installUnownedTopicWarning`, for the
 * frames that belong to neither. An `error` carrying a requestId is a command's
 * reply and an `error` carrying a topic is a channel that broke at the wire;
 * what was left over reached the command correlator, which returns immediately
 * on a missing requestId, and died there. The mod had already written the
 * sentence that explains the fault and the author never saw it.
 *
 * Two live producers today, both of them useful and both of them previously
 * invisible: `binary-frame-not-accepted` (a binary-lane frame sent UP the
 * socket, which nothing accepts) and the `unknown-vantage` refusal of a
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
 * Reported at the point the client would otherwise DISCARD the frame: an error
 * carrying neither a requestId nor a topic correlates to nothing, so the
 * command correlator drops it and there is nothing else downstream to notice.
 *
 * Once per code per session, the same budget `warnChannelError` keeps: a client
 * that sends one bad binary frame usually sends many, and reprinting the same
 * sentence per frame buries it.
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
