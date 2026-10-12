import { hasHost } from "../api/host";
import { logger } from "../api/logger";
import type { TelemetryClient } from "./client";

/**
 * Logs one warning when a widget is subscribed to a topic nothing publishes.
 * Useful for telling an Uplink author why a widget renders blank, where otherwise
 * there would be no error, banner or health row and a `pending` reading looks
 * like data on its way. Installed by the telemetry context provider.
 *
 * The log names the topic, the widget that asked for it, and what to do about it,
 * at the moment the mod's silence becomes an answer. It fires once per topic per
 * session: the verdict is re-earned on every reconnect (see
 * `TopicOwnershipTracker`), so a flapping connection would otherwise reprint the
 * same paragraph on every retry.
 */
export function installUnownedTopicWarning(
  client: TelemetryClient,
): () => void {
  const warned = new Set<string>();
  return client.onTopicUnowned((topic) => {
    if (warned.has(topic)) return;
    warned.add(topic);
    // The logger is host-injected and fails loud when no host is installed,
    // which is the ordinary state of a unit test. A diagnostic must never be
    // the thing that breaks the run it is diagnosing.
    if (!hasHost()) return;
    const readers = client.readersOf(topic);
    logger.warn(unownedTopicMessage(topic, readers), {
      topic,
      readers,
    });
  });
}

/**
 * The text of the unowned topic warning, exported so a test can assert on it
 * without a host. Useful for an Uplink author who meets the warning without
 * knowing the mechanism: it says what was observed, what it means, and the three
 * causes in the order they are worth checking.
 */
export function unownedTopicMessage(
  topic: string,
  readers: readonly string[],
): string {
  const who =
    readers.length === 0
      ? "Something is reading it"
      : `Read by ${readers.join(", ")}`;
  return (
    `[unowned topic] Nothing will ever publish "${topic}". ${who}, and that read ` +
    `will never resolve. The mod either refused the subscribe with an ` +
    `unknownTopic error or never acked it, which means no installed Uplink ` +
    `declares the channel and it falls under no dynamic namespace. Check, in ` +
    `order: the topic is spelled the way the ` +
    `Uplink declares it; the Uplink that owns it is installed and enabled; and its ` +
    `Register did not throw on load, which fail-softs and leaves its channels ` +
    `undeclared (the system.uplinks roster carries available:false and a reason).`
  );
}
