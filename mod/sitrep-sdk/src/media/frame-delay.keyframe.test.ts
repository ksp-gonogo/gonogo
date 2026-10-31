/**
 * What `runFrameDelayPipeline` does with encoded video when frames are
 * discarded: a flush leaves the stream waiting for a keyframe rather than
 * writing deltas whose references were dropped, and the running totals say
 * where frames went.
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
}

function coded(label: string, type: "key" | "delta"): CodedFrame {
  return { label, type };
}

function manualClock(): DelayClockLike & { setEdge(v: number): void } {
  let edge = Number.NEGATIVE_INFINITY;
  const listeners = new Set<(viewUt: number) => void>();
  return {
    confirmedEdgeUt: () => edge,
    onFrame: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setEdge(v: number) {
      edge = v;
      listeners.forEach((cb) => {
        cb(v);
      });
    },
  };
}

/** A source the test pushes frames into one at a time. */
function pushSource(): FrameSource<CodedFrame> & {
  push(frame: CodedFrame): void;
} {
  const waiting: Array<(r: ReadableStreamReadResult<CodedFrame>) => void> = [];
  const backlog: CodedFrame[] = [];
  return {
    push(frame) {
      const next = waiting.shift();
      if (next) next({ done: false, value: frame });
      else backlog.push(frame);
    },
    read: () => {
      const frame = backlog.shift();
      if (frame) return Promise.resolve({ done: false, value: frame });
      return new Promise((resolve) => waiting.push(resolve));
    },
    cancel: () => Promise.resolve(),
  };
}

function recordingSink(): FrameSink<CodedFrame> & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    write(frame) {
      if (!frame) throw new Error("the pipeline wrote no frame");
      written.push(frame.label);
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };
}

function encodedPipeline(onNeedKeyframe?: () => void) {
  const clock = manualClock();
  const source = pushSource();
  const sink = recordingSink();
  let ut = 100;
  const pipeline = runFrameDelayPipeline<CodedFrame>({
    view: clock,
    captureUt: () => {
      ut += 0.033;
      return ut;
    },
    source,
    sink,
    maxBufferedFrames: 1000,
    isKeyframe: (f) => f.type === "key",
    gopSafeEviction: true,
    onNeedKeyframe,
    pacing: { maxBacklogSeconds: 1 },
  });
  return { clock, source, sink, pipeline };
}

describe("runFrameDelayPipeline: encoded video after a flush", () => {
  it("drops deltas until the next keyframe, asks for one, and counts what it dropped", async () => {
    const onNeedKeyframe = vi.fn();
    const { clock, source, sink, pipeline } = encodedPipeline(onNeedKeyframe);

    source.push(coded("K0", "key"));
    source.push(coded("d1", "delta"));
    await vi.waitFor(() => expect(pipeline.stats().read).toBe(2));

    pipeline.flush();
    expect(onNeedKeyframe).toHaveBeenCalledTimes(1);
    expect(pipeline.stats().flushDropped).toBe(2);

    source.push(coded("d2", "delta"));
    source.push(coded("d3", "delta"));
    source.push(coded("K1", "key"));
    source.push(coded("d4", "delta"));
    await vi.waitFor(() => expect(pipeline.stats().read).toBe(6));

    clock.setEdge(1000);
    for (let t = 0; t < 1; t += 0.05) pipeline.tickPacing(t);

    expect(sink.written).toEqual(["K1", "d4"]);
    expect(pipeline.stats().awaitingKeyframeDropped).toBe(2);
  });

  it("a flush that discards nothing leaves the reference chain intact and waits for no keyframe", async () => {
    const onNeedKeyframe = vi.fn();
    const { clock, source, sink, pipeline } = encodedPipeline(onNeedKeyframe);

    source.push(coded("K0", "key"));
    await vi.waitFor(() => expect(pipeline.stats().read).toBe(1));
    clock.setEdge(1000);
    pipeline.tickPacing(0);
    expect(sink.written).toEqual(["K0"]);

    pipeline.flush();
    expect(onNeedKeyframe).not.toHaveBeenCalled();

    source.push(coded("d1", "delta"));
    await vi.waitFor(() => expect(pipeline.stats().read).toBe(2));
    pipeline.tickPacing(0.1);
    expect(sink.written).toEqual(["K0", "d1"]);
  });

  it("counts frames the pacer skipped to catch up, keeping the references of what it presents", async () => {
    const { clock, source, sink, pipeline } = encodedPipeline();

    source.push(coded("K0", "key"));
    await vi.waitFor(() => expect(pipeline.stats().read).toBe(1));
    clock.setEdge(1000);
    pipeline.tickPacing(0);

    source.push(coded("d1", "delta"));
    source.push(coded("d2", "delta"));
    source.push(coded("K1", "key"));
    source.push(coded("d3", "delta"));
    await vi.waitFor(() => expect(pipeline.stats().read).toBe(5));
    clock.setEdge(2000);

    pipeline.tickPacing(30);

    expect(sink.written[1]).toBe("K1");
    expect(pipeline.stats().pacerSkipped).toBe(2);
  });
});
