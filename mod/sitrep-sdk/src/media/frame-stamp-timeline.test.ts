import { describe, expect, it } from "vitest";
import {
  bindFrameStamps,
  type FrameStamp,
  type FrameStampFeed,
  FrameStampTimeline,
} from "./frame-stamp-timeline";

const stamp = (rtpTimestamp: number, ut: number, epoch = 1): FrameStamp => ({
  rtpTimestamp,
  ut,
  epoch,
});

describe("FrameStampTimeline", () => {
  it("dates a frame exactly from its own stamp", () => {
    const timeline = new FrameStampTimeline();
    timeline.record(stamp(9000, 100.25));

    expect(timeline.utFor(9000)).toEqual({
      ut: 100.25,
      epoch: 1,
      source: "exact",
    });
  });

  it("dates a frame whose stamp was dropped from the stamps either side of it", () => {
    const timeline = new FrameStampTimeline();
    timeline.record(stamp(0, 100));
    timeline.record(stamp(9000, 100.2));

    expect(timeline.utFor(4500)).toEqual({
      ut: 100.1,
      epoch: 1,
      source: "interpolated",
    });
  });

  it("carries a frame newer than every stamp forward at the rate of the newest two", () => {
    const timeline = new FrameStampTimeline();
    timeline.record(stamp(0, 100));
    timeline.record(stamp(3000, 100.05));

    expect(timeline.utFor(6000)?.source).toBe("extrapolated");
    expect(timeline.utFor(6000)?.ut).toBeCloseTo(100.1, 9);
  });

  it("holds a frame at the newest stamp when it has no rate to go on", () => {
    const timeline = new FrameStampTimeline();
    timeline.record(stamp(0, 100));
    expect(timeline.utFor(3000)).toEqual({ ut: 100, epoch: 1, source: "held" });

    timeline.record(stamp(3000, 100.05));
    // Half a second past the newest stamp is as far as the rate is trusted
    expect(timeline.utFor(3000 + 45001)).toEqual({
      ut: 100.05,
      epoch: 1,
      source: "held",
    });
  });

  it("cannot date a frame before any stamp or older than all of them", () => {
    const timeline = new FrameStampTimeline();
    expect(timeline.utFor(0)).toBeNull();

    timeline.record(stamp(9000, 100));
    expect(timeline.utFor(3000)).toBeNull();
  });

  it("accepts stamps that arrive out of order", () => {
    const timeline = new FrameStampTimeline();
    timeline.record(stamp(6000, 100.1));
    timeline.record(stamp(0, 100));
    timeline.record(stamp(3000, 100.05));

    expect(timeline.utFor(1500)?.ut).toBeCloseTo(100.025, 9);
  });

  it("follows the RTP timestamp across its 32-bit wrap", () => {
    const timeline = new FrameStampTimeline();
    const nearTop = 2 ** 32 - 1500;
    timeline.record(stamp(nearTop, 100));
    timeline.record(stamp(1500, 100.0333));

    expect(timeline.utFor(0)?.source).toBe("interpolated");
    expect(timeline.utFor(0)?.ut).toBeCloseTo(100.01665, 4);
    expect(timeline.utFor(1500)?.source).toBe("exact");
  });

  it("discards every earlier stamp when a new epoch arrives, and says so", () => {
    const timeline = new FrameStampTimeline();
    expect(timeline.record(stamp(0, 5000, 1))).toBe(false);
    expect(timeline.record(stamp(3000, 5000.03, 1))).toBe(false);

    expect(timeline.record(stamp(6000, 1200, 2))).toBe(true);

    expect(timeline.utFor(3000)).toBeNull();
    expect(timeline.utFor(6000)).toEqual({
      ut: 1200,
      epoch: 2,
      source: "exact",
    });
    // Held at the new epoch's stamp, never carried on from the old epoch's rate
    expect(timeline.utFor(9000)).toEqual({
      ut: 1200,
      epoch: 2,
      source: "held",
    });
  });
});

describe("FrameStampTimeline when the camera restarts inside one epoch", () => {
  it("drops the old stamps and dates from the new stream when RTP and UT both go back", () => {
    const timeline = new FrameStampTimeline();
    timeline.record(stamp(90000, 1000));
    timeline.record(stamp(93600, 1000.04));

    expect(timeline.record(stamp(3000, 200))).toBe(true);

    expect(timeline.utFor(3000)).toEqual({
      ut: 200,
      epoch: 1,
      source: "exact",
    });
    expect(timeline.utFor(90000)?.ut).toBe(200);
  });

  it("restarts when UT goes back although RTP carries on", () => {
    const timeline = new FrameStampTimeline();
    timeline.record(stamp(0, 1000));
    timeline.record(stamp(3600, 1000.04));

    expect(timeline.record(stamp(7200, 200))).toBe(true);
    expect(timeline.utFor(7200)?.ut).toBe(200);
  });

  it("restarts when RTP goes back by more than a reorder window", () => {
    const timeline = new FrameStampTimeline();
    timeline.record(stamp(2_000_000, 1000));
    timeline.record(stamp(2_003_600, 1000.04));

    expect(timeline.record(stamp(10_000, 1000.1))).toBe(true);
    expect(timeline.utFor(2_000_000)?.ut).toBe(1000.1);
  });

  it("does not restart on a reordered stamp", () => {
    const timeline = new FrameStampTimeline();
    timeline.record(stamp(0, 1000));
    timeline.record(stamp(7200, 1000.08));

    expect(timeline.record(stamp(3600, 1000.04))).toBe(false);
    expect(timeline.utFor(0)?.source).toBe("exact");
  });

  it("clears on reset so the next stamp starts a fresh timeline", () => {
    const timeline = new FrameStampTimeline();
    timeline.record(stamp(90000, 1000));
    timeline.clear();
    timeline.record(stamp(3000, 1000.5));

    expect(timeline.utFor(3000)?.source).toBe("exact");
    expect(timeline.utFor(90000)?.ut).toBe(1000.5);
  });
});

function manualFeed(): FrameStampFeed & { send(s: FrameStamp): void } {
  const listeners = new Set<(s: FrameStamp) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send(s) {
      for (const listener of listeners) listener(s);
    },
  };
}

const frame = (rtpTimestamp: number) => ({
  metadata: () => ({ rtpTimestamp }),
});

describe("bindFrameStamps", () => {
  it("dates frames from the feed by the RTP timestamp in their metadata", () => {
    const feed = manualFeed();
    const bound = bindFrameStamps(feed, () => {});
    feed.send(stamp(3000, 42));

    expect(bound.captureUt(frame(3000))).toBe(42);
  });

  it("reads the metadata of an encoded frame too", () => {
    const feed = manualFeed();
    const bound = bindFrameStamps(feed, () => {});
    feed.send(stamp(3000, 42));

    expect(
      bound.captureUt({ getMetadata: () => ({ rtpTimestamp: 3000 }) }),
    ).toBe(42);
  });

  it("stamps a frame it cannot date so that it is held, never released", () => {
    const bound = bindFrameStamps(manualFeed(), () => {});

    expect(bound.captureUt(frame(3000))).toBe(Number.POSITIVE_INFINITY);
    expect(bound.captureUt({})).toBe(Number.POSITIVE_INFINITY);
  });

  it("calls back when the camera starts a new epoch", () => {
    const feed = manualFeed();
    let resets = 0;
    bindFrameStamps(feed, () => {
      resets += 1;
    });

    feed.send(stamp(0, 10, 1));
    feed.send(stamp(3000, 10.03, 1));
    expect(resets).toBe(0);
    feed.send(stamp(6000, 3, 2));
    expect(resets).toBe(1);
  });

  it("calls back and re-dates from the new stream when the camera restarts inside one epoch", () => {
    const feed = manualFeed();
    let resets = 0;
    const bound = bindFrameStamps(feed, () => {
      resets += 1;
    });
    feed.send(stamp(90000, 1000));
    feed.send(stamp(3000, 200));

    expect(resets).toBe(1);
    expect(bound.captureUt(frame(3000))).toBe(200);
  });

  it("reset forgets every stamp", () => {
    const feed = manualFeed();
    const bound = bindFrameStamps(feed, () => {});
    feed.send(stamp(3000, 42));
    bound.reset();

    expect(bound.captureUt(frame(3000))).toBe(Number.POSITIVE_INFINITY);
  });

  it("stops listening when disposed", () => {
    const feed = manualFeed();
    const bound = bindFrameStamps(feed, () => {});
    bound.dispose();
    feed.send(stamp(3000, 42));

    expect(bound.captureUt(frame(3000))).toBe(Number.POSITIVE_INFINITY);
  });
});
