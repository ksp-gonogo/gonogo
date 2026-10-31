import type { FrameDelayStatsDetail } from "../frame-delay";

/** The log tag a delayed camera's summaries are written under. */
export const FRAME_DELAY_LOG_TAG = "frame-delay";

/** How often a delayed camera writes its summary, in milliseconds. */
export const FRAME_DELAY_SUMMARY_INTERVAL_MS = 10_000;

interface SummaryLog {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

/**
 * The function that turns each running-totals report from one delayed camera
 * into a log line: what came in and went out since the last report, how many
 * frames were skipped or dropped, how many keyframes were asked for and how
 * long the waits for them ran, and how much is buffered now. A report that
 * arrives while `logTo` has no log yet is skipped and counted in the next one.
 * Writes one warning
 * the first time a keyframe request could not be sent, since the picture then
 * waits for the sender's own keyframe interval after every skip.
 */
export function createFrameDelayReporter(
  pipelineId: string,
  logTo: () => SummaryLog | undefined,
): (stats: FrameDelayStatsDetail) => void {
  let previous: FrameDelayStatsDetail | null = null;
  let warnedUnsupported = false;
  return (stats) => {
    const log = logTo();
    if (!log) return;
    const since = (pick: (s: FrameDelayStatsDetail) => number) =>
      pick(stats) - (previous ? pick(previous) : 0);
    log.info("frame delay summary", {
      pipelineId,
      framesIn: since((s) => s.read),
      framesOut: since((s) => s.presented),
      pacerSkipped: since((s) => s.pacerSkipped),
      pacerCatchUps: since((s) => s.pacerCatchUps),
      flushDropped: since((s) => s.flushDropped),
      evicted: since((s) => s.evicted),
      awaitingKeyframeDropped: since((s) => s.awaitingKeyframeDropped),
      keyframeRequests: since((s) => s.keyframeRequests),
      keyframeRequestsFailed: since((s) => s.keyframeRequestsFailed),
      keyframeWaits: since((s) => s.keyframeWaits),
      keyframeWaitMsLongest: Math.round(stats.keyframeWaitMsLongest),
      keyframeWaitingMs: Math.round(stats.keyframeWaitingMs),
      buffered: stats.buffered,
    });
    if (stats.keyframeRequestsFailed > 0 && !warnedUnsupported) {
      warnedUnsupported = true;
      log.warn(
        "keyframe requests cannot be sent from this browser, so a skipped or flushed picture waits for the sender's own keyframe interval",
        { pipelineId },
      );
    }
    previous = stats;
  };
}

/** `onStats` and the summary writer, called together. */
export function withFrameDelayReporter(
  pipelineId: string,
  onStats: ((stats: FrameDelayStatsDetail) => void) | undefined,
): (stats: FrameDelayStatsDetail) => void {
  /* The logger is reached through a dynamic import so the media entry has no
     static edge to the rest of the sdk. */
  let log: SummaryLog | undefined;
  void import("../../api/logger")
    .then((m) => {
      log = m.logger.tag(FRAME_DELAY_LOG_TAG);
    })
    .catch(() => {});
  const report = createFrameDelayReporter(pipelineId, () => log);
  return (stats) => {
    report(stats);
    onStats?.(stats);
  };
}
