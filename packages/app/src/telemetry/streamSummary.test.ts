import { describe, expect, it, vi } from "vitest";
import {
  STREAM_SUMMARY_INTERVAL_MS,
  startStreamSummary,
} from "./streamSummary";

describe("startStreamSummary", () => {
  it("writes the messages by kind, the topics that sent data and the clock's numbers, then starts counting again", () => {
    vi.useFakeTimers();
    let listener: ((m: { type: string; topic?: string }) => void) | undefined;
    const off = vi.fn();
    const log = { info: vi.fn() };
    const stop = startStreamSummary(
      {
        onRawMessage: (l) => {
          listener = l;
          return off;
        },
      },
      {
        snapshot: () => ({
          epoch: 1,
          anchorWall: 0,
          anchorUt: 105,
          maxSampleUt: 105.18,
          delaySeconds: 0.015,
          warpRate: 1,
          slackSeconds: 0,
        }),
        utNowEstimate: () => 115.485,
      },
      log,
    );
    listener?.({ type: "stream-data", topic: "comms.delay" });
    listener?.({ type: "stream-data", topic: "comms.delay" });
    listener?.({ type: "stream-data", topic: "vessel.flight" });
    listener?.({ type: "subscribed" });
    vi.advanceTimersByTime(STREAM_SUMMARY_INTERVAL_MS);
    expect(log.info).toHaveBeenLastCalledWith("stream summary", {
      messages: { "stream-data": 3, subscribed: 1 },
      dataTopics: 2,
      clock: {
        utNow: 115.485,
        maxSampleUt: 105.18,
        delaySeconds: 0.015,
        epoch: 1,
      },
    });

    vi.advanceTimersByTime(STREAM_SUMMARY_INTERVAL_MS);
    expect(log.info).toHaveBeenLastCalledWith(
      "stream summary",
      expect.objectContaining({ messages: {}, dataTopics: 0 }),
    );
    stop();
    expect(off).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
