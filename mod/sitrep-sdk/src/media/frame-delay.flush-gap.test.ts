/**
 * What `runFrameDelayPipeline` does around a flush of encoded video: the
 * picture resumes within a release gap, a keyframe lost to a missing stamp is
 * asked for again, and no frame is written before the clock has reached it.
 */

import { describe, expect, it, vi } from "vitest";
import type { DelayClockLike } from "./delayed-playout-buffer";
import {
  type FrameLike,
  type FrameSink,
  type FrameSource,
  runFrameDelayPipeline,
} from "./frame-delay";

interface CodedFrame extends FrameLike {
  label: string;
  type: "key" | "delta";
  ut: number;
}

function coded(label: string, type: "key" | "delta", ut: number): CodedFrame {
  return { label, type, ut };
}

function harness(onNeedKeyframe: () => void) {
  let edge = Number.NEGATIVE_INFINITY;
  const listeners = new Set<(viewUt: number) => void>();
  const clock: DelayClockLike = {
    confirmedEdgeUt: () => edge,
    onFrame: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    sampleStepSeconds: () => 0.1,
  };
  const setEdge = (v: number) => {
    edge = v;
    listeners.forEach((cb) => {
      cb(v);
    });
  };

  const waiting: Array<(r: ReadableStreamReadResult<CodedFrame>) => void> = [];
  const backlog: CodedFrame[] = [];
  const source: FrameSource<CodedFrame> = {
    read: () => {
      const frame = backlog.shift();
      if (frame) return Promise.resolve({ done: false, value: frame });
      return new Promise((resolve) => waiting.push(resolve));
    },
    cancel: () => Promise.resolve(),
  };
  const push = (frame: CodedFrame) => {
    const next = waiting.shift();
    if (next) next({ done: false, value: frame });
    else backlog.push(frame);
  };

  const written: { label: string; wall: number; edge: number; ut: number }[] =
    [];
  let wall = 0;
  const sink: FrameSink<CodedFrame> = {
    write(frame) {
      if (!frame) throw new Error("the pipeline wrote no frame");
      written.push({ label: frame.label, wall, edge, ut: frame.ut });
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };

  const pipeline = runFrameDelayPipeline<CodedFrame>({
    view: clock,
    captureUt: (f) => f.ut,
    source,
    sink,
    maxBufferedFrames: 1000,
    isKeyframe: (f) => f.type === "key",
    gopSafeEviction: true,
    onNeedKeyframe,
    pacing: {
      maxBacklogSeconds: 1,
      maxLeadSeconds: 2,
      expectedReleaseGapSeconds: () => 0.1,
    },
  });
  const run = (to: number) => {
    for (; wall <= to; wall += 0.01) pipeline.tickPacing(wall);
  };
  return { push, setEdge, written, pipeline, run };
}

describe("runFrameDelayPipeline: a flush of encoded video that is already playing", () => {
  it("writes the restarted run within one release gap of the last frame it showed", async () => {
    const { push, setEdge, written, pipeline, run } = harness(() => {});
    push(coded("K0", "key", 10));
    await vi.waitFor(() => expect(pipeline.stats().read).toBe(1));
    setEdge(10);
    run(0.2);
    expect(written.map((w) => w.label)).toEqual(["K0"]);
    const lastShown = written[0]?.wall ?? 0;

    pipeline.flush();
    setEdge(2.9);
    run(0.32);
    push(coded("K1", "key", 3));
    push(coded("d1", "delta", 3.02));
    await vi.waitFor(() => expect(pipeline.stats().read).toBe(3));
    setEdge(3.05);
    run(0.6);

    const resumed = written.find((w) => w.label === "K1");
    expect(resumed).toBeDefined();
    expect((resumed?.wall ?? 99) - lastShown).toBeLessThan(0.25);
  });

  it("never writes a frame before the clock has reached its capture time", async () => {
    const { push, setEdge, written, pipeline, run } = harness(() => {});
    push(coded("K0", "key", 10));
    await vi.waitFor(() => expect(pipeline.stats().read).toBe(1));
    setEdge(10);
    run(0.2);

    pipeline.flush();
    setEdge(2.9);
    push(coded("K1", "key", 3));
    push(coded("d1", "delta", 3.02));
    push(coded("d2", "delta", 3.2));
    await vi.waitFor(() => expect(pipeline.stats().read).toBe(4));
    setEdge(3.05);
    run(0.6);
    setEdge(3.25);
    run(1);

    expect(written.length).toBeGreaterThanOrEqual(3);
    for (const w of written) expect(w.ut).toBeLessThanOrEqual(w.edge);
  });
});

describe("runFrameDelayPipeline: a keyframe that had no capture stamp yet", () => {
  it("asks for a new keyframe when a dated delta arrives and drops the undated one", async () => {
    const onNeedKeyframe = vi.fn();
    const { push, setEdge, written, pipeline, run } = harness(onNeedKeyframe);

    push(coded("K0", "key", Number.POSITIVE_INFINITY));
    push(coded("d1", "delta", 5));
    push(coded("d2", "delta", 5.03));
    await vi.waitFor(() => expect(pipeline.stats().read).toBe(3));

    expect(onNeedKeyframe).toHaveBeenCalledTimes(1);
    expect(pipeline.stats().awaitingKeyframeDropped).toBe(2);

    push(coded("K1", "key", 5.1));
    push(coded("d3", "delta", 5.13));
    await vi.waitFor(() => expect(pipeline.stats().read).toBe(5));
    setEdge(6);
    run(0.5);

    expect(written.map((w) => w.label)).toEqual(["K1", "d3"]);
    expect(onNeedKeyframe).toHaveBeenCalledTimes(1);
  });

  it("writes a dated keyframe that follows undated frames, with no new request", async () => {
    const onNeedKeyframe = vi.fn();
    const { push, setEdge, written, pipeline, run } = harness(onNeedKeyframe);

    push(coded("d0", "delta", Number.POSITIVE_INFINITY));
    push(coded("K1", "key", 5));
    push(coded("d1", "delta", 5.03));
    await vi.waitFor(() => expect(pipeline.stats().read).toBe(3));
    setEdge(6);
    run(0.5);

    expect(written.map((w) => w.label)).toEqual(["K1", "d1"]);
    expect(onNeedKeyframe).not.toHaveBeenCalled();
  });
});
