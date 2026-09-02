import { hasHost } from "../api/host";
import { logger } from "../api/logger";

/**
 * The mod answered a subscribe and then failed to put that channel's payload
 * on the wire.
 *
 * Sibling of `installUnownedTopicWarning`, for the silence that one cannot
 * see. That diagnostic fires when a subscribe is never acked, which is what an
 * undeclared topic looks like. This one is the opposite shape and reads
 * identically to an author: the topic IS declared, the subscribe IS acked, and
 * nothing ever arrives, because every delivery dies at the wire boundary. The
 * commonest cause by far is publishing a plain CLR type the wire codec cannot
 * write, which no amount of staring at the widget will reveal.
 *
 * Once per topic and code per session: the mod marks the owning Uplink
 * Unavailable on the first failure, so this normally fires exactly once, but a
 * reconnect re-earns the whole verdict and would otherwise reprint it.
 */
export function channelErrorMessage(
  topic: string,
  code: string,
  message: string,
): string {
  return (
    `[channel error] The mod accepted the subscribe for "${topic}" and then ` +
    `refused the frame (${code}): ${message} Nothing will arrive on this topic ` +
    `until that is fixed, and a widget reading it will sit on a pending value ` +
    `that looks exactly like data on its way. If this is your Uplink: the wire ` +
    `codec writes numbers, strings, booleans, enums, dictionaries, arrays and ` +
    `the declared contract types, so a plain class of your own has to be ` +
    `flattened to a Dictionary<string, object?> before you publish it. The ` +
    `owning Uplink is also marked Unavailable, with the same reason, on the ` +
    `system.uplinks roster and in KSP.log.`
  );
}

/**
 * Reported at the point the client would otherwise DISCARD the frame: an error
 * carrying a topic and no requestId is not a reply to any command, so the
 * command correlator drops it and there is nothing else downstream to notice.
 */
export function warnChannelError(
  warned: Set<string>,
  topic: string,
  code: string,
  message: string,
): void {
  const id = `${topic} ${code}`;
  if (warned.has(id)) return;
  warned.add(id);
  // The logger is host-injected and fails loud when no host is installed, the
  // ordinary state of a unit test. A diagnostic must never be the thing that
  // breaks the run it is diagnosing.
  if (!hasHost()) return;
  logger.warn(channelErrorMessage(topic, code, message), {
    topic,
    code,
    detail: message,
  });
}
