import { describe, expect, it, vi } from "vitest";
import type { FrameDelayStatsDetail } from "../frame-delay";
import { createFrameDelayReporter } from "./frame-delay-report";

function stats(over: Partial<FrameDelayStatsDetail>): FrameDelayStatsDetail {
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
    bufferedBytes: 0,
    capBytes: 1000,
    shedding: false,
    sheddingStarts: 0,
    ...over,
  };
}

describe("createFrameDelayReporter", () => {
  it("writes what changed since the last report and what is held now", () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const report = createFrameDelayReporter("encoded-1", () => log);

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
    const report = createFrameDelayReporter("encoded-1", () => log);

    report(stats({ keyframeRequests: 1 }));
    expect(log.warn).not.toHaveBeenCalled();

    report(stats({ keyframeRequests: 2, keyframeRequestsFailed: 2 }));
    report(stats({ keyframeRequests: 3, keyframeRequestsFailed: 3 }));
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("skips a report until a log exists and counts it in the next one", () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    let ready: typeof log | undefined;
    const report = createFrameDelayReporter("encoded-1", () => ready);

    report(stats({ read: 100 }));
    expect(log.info).not.toHaveBeenCalled();

    ready = log;
    report(stats({ read: 250 }));
    expect(log.info).toHaveBeenCalledWith(
      "frame delay summary",
      expect.objectContaining({ framesIn: 250 }),
    );
  });

  it("logs once when shedding starts and once when it stops", () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const report = createFrameDelayReporter("encoded-1", () => log);

    report(stats({ read: 300 }));
    report(
      stats({
        read: 600,
        shedding: true,
        sheddingStarts: 1,
        bufferedBytes: 990,
      }),
    );
    report(
      stats({
        read: 900,
        shedding: true,
        sheddingStarts: 1,
        bufferedBytes: 990,
      }),
    );
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]?.[1]).toMatchObject({
      bufferedBytes: 990,
      capBytes: 1000,
    });

    report(stats({ read: 1200, sheddingStarts: 1 }));
    const stopped = log.info.mock.calls.filter(([m]) =>
      /keeping every frame/.test(String(m)),
    );
    expect(stopped).toHaveLength(1);
  });

  it("reports the bytes held in each summary", () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const report = createFrameDelayReporter("encoded-1", () => log);

    report(stats({ bufferedBytes: 777, buffered: 5 }));

    expect(log.info.mock.calls[0]?.[1]).toMatchObject({
      bufferedBytes: 777,
      capBytes: 1000,
      buffered: 5,
    });
  });

  it("writes the clock's numbers and says once when the newest sample holds the release back", () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const report = createFrameDelayReporter("encoded-1", () => log);
    const release = (edgeUt: number) => ({
      edgeUt,
      utNow: 150,
      maxSampleUt: 85,
      delaySeconds: 23,
      slackSeconds: 0,
      epoch: 0,
    });

    report(stats({ buffered: 300 }), release(127));
    expect(log.warn).not.toHaveBeenCalled();

    report(stats({ buffered: 600 }), release(85));
    report(stats({ buffered: 900 }), release(85));
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]?.[1]).toMatchObject({
      release: { edgeUt: 85, utNow: 150, maxSampleUt: 85, delaySeconds: 23 },
    });
    expect(log.info.mock.calls.at(-1)?.[1]).toMatchObject({
      release: { edgeUt: 85, maxSampleUt: 85 },
    });

    report(stats({ buffered: 10 }), release(127));
    expect(
      log.info.mock.calls.filter(([m]) =>
        /following the delayed/.test(String(m)),
      ),
    ).toHaveLength(1);
  });
});
