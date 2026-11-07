import type { ClockFormulaSnapshot } from "@ksp-gonogo/sitrep-sdk";

/** How often a screen writes what its stream delivered, in milliseconds. */
export const STREAM_SUMMARY_INTERVAL_MS = 10_000;

interface SummaryLog {
  info(message: string, context?: Record<string, unknown>): void;
}

interface SummarySource {
  /** Calls `listener` for each message the game sends this screen; returns the function that stops it. */
  onRawMessage(
    listener: (message: { type: string; topic?: string }) => void,
  ): () => void;
}

/**
 * Writes, every {@link STREAM_SUMMARY_INTERVAL_MS}, what the game's stream
 * delivered to this screen since the last line: messages by kind, how many
 * distinct Topics sent data, and the numbers of the view clock they feed. A
 * screen whose clock stops moving while the game runs shows it here as no data
 * messages, with the clock's newest sample unchanged.
 * Returns the function that stops it.
 */
export function startStreamSummary(
  source: SummarySource,
  clock: { snapshot(): ClockFormulaSnapshot; utNowEstimate(): number },
  log: SummaryLog,
  setTimer: typeof setInterval = setInterval,
  clearTimer: typeof clearInterval = clearInterval,
): () => void {
  let kinds = new Map<string, number>();
  let topics = new Set<string>();
  const off = source.onRawMessage((message) => {
    kinds.set(message.type, (kinds.get(message.type) ?? 0) + 1);
    if (message.type === "stream-data" && message.topic)
      topics.add(message.topic);
  });
  const timer = setTimer(() => {
    const snapshot = clock.snapshot();
    log.info("stream summary", {
      messages: Object.fromEntries(kinds),
      dataTopics: topics.size,
      clock: {
        utNow: clock.utNowEstimate(),
        maxSampleUt: snapshot.maxSampleUt,
        delaySeconds: snapshot.delaySeconds,
        epoch: snapshot.epoch,
      },
    });
    kinds = new Map();
    topics = new Set();
  }, STREAM_SUMMARY_INTERVAL_MS);
  return () => {
    off();
    clearTimer(timer);
  };
}
