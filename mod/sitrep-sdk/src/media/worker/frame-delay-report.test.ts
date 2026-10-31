import { describe, expect, it, vi } from "vitest";
import type { FrameDelayStats } from "../frame-delay";
import { createFrameDelayReporter } from "./frame-delay-report";

function stats(over: Partial<FrameDelayStats>): FrameDelayStats {
  return {
    read: 0,
    presented: 0,
    pacerSkipped: 0,
    pacerCatchUps: 0,
    flushDropped: 0,
    evicted: 0,
    awaitingKeyframeDropped: 0,
    buffered: 0,
    keyframeRequests: 0,
    keyframeRequestsFailed: 0,
    keyframeWaits: 0,
    keyframeWaitMsTotal: 0,
    keyframeWaitMsLongest: 0,
    keyframeWaitingMs: 0,
    ...over,
  };
}

describe("createFrameDelayReporter", () => {
  it("writes what changed since the last report and what is held now", () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const report = createFrameDelayReporter("encoded-1", log);

    report(stats({ read: 300, presented: 290, buffered: 12 }));
    report(
      stats({
        read: 330,
        presented: 300,
        pacerSkipped: 4,
        keyframeRequests: 1,
        keyframeWaits: 1,
        keyframeWaitMsLongest: 812.4,
        buffered: 40,
      }),
    );

    expect(log.info).toHaveBeenLastCalledWith(
      "frame delay summary",
      expect.objectContaining({
        pipelineId: "encoded-1",
        framesIn: 30,
        framesOut: 10,
        pacerSkipped: 4,
        keyframeRequests: 1,
        keyframeWaits: 1,
        keyframeWaitMsLongest: 812,
        buffered: 40,
      }),
    );
  });

  it("warns once, and only once, that keyframe requests cannot be sent", () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const report = createFrameDelayReporter("encoded-1", log);

    report(stats({ keyframeRequests: 1 }));
    expect(log.warn).not.toHaveBeenCalled();

    report(stats({ keyframeRequests: 2, keyframeRequestsFailed: 2 }));
    report(stats({ keyframeRequests: 3, keyframeRequestsFailed: 3 }));
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
