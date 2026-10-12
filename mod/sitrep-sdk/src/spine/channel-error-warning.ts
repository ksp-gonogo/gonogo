import { hasHost } from "../api/host";
import { logger } from "../api/logger";

/**
 * Returns the warning text for a Topic whose subscribe the mod accepted and
 * whose payload it then failed to put on the wire. The Topic is declared and
 * the subscribe is acked, but nothing arrives. The commonest cause is an Uplink
 * publishing a plain CLR type that the wire codec cannot write. Useful for
 * telling an Uplink author why a widget reading the Topic stays pending. Used by
 * `warnChannelError`.
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
 * Logs the warning from `channelErrorMessage` once for each topic and code in
 * a session, so a reconnect does not print it again. Does nothing when no host
 * is installed, as in a unit test. Useful for telling an Uplink author that a
 * Topic will never deliver. Used by the Sitrep client when it receives an error
 * that names a Topic and answers no command.
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
