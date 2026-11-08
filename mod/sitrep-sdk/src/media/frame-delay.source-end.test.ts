import { describe, expect, it, vi } from "vitest";
import type { DelayClockLike } from "./delayed-playout-buffer";
import {
  type FrameLike,
  type FrameSink,
  type FrameSource,
  runFrameDelayPipeline,
} from "./frame-delay";

const clock: DelayClockLike = {
  confirmedEdgeUt: () => Number.POSITIVE_INFINITY,
  onFrame: () => () => {},
};

const sink: FrameSink<FrameLike> = {
  write: async () => {},
  close: async () => {},
};

/* A source that gives `count` frames, then either ends by itself or, with `endOnCancel`, waits until cancelled. */
function source(count: number, endOnCancel: boolean): FrameSource<FrameLike> {
  let given = 0;
  let cancel: (() => void) | null = null;
  return {
    read: () => {
      if (given < count) {
        given += 1;
        return Promise.resolve({ done: false as const, value: { close() {} } });
      }
      if (!endOnCancel)
        return Promise.resolve({ done: true as const, value: undefined });
      return new Promise((resolve) => {
        cancel = () => resolve({ done: true as const, value: undefined });
      });
    },
    cancel: async () => {
      cancel?.();
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("runFrameDelayPipeline: the source ending", () => {
  it("reports a source that ends while the delay runs, with how many frames it gave", async () => {
    const onError = vi.fn();
    runFrameDelayPipeline({
      view: clock,
      captureUt: () => 1,
      source: source(2, false),
      sink,
      onError,
    });
    await settle();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0])).toContain(
      "the frame source ended after 2 frames while the delay was still running",
    );
  });

  it("says nothing when disposing the pipeline is what ended its source", async () => {
    const onError = vi.fn();
    const pipeline = runFrameDelayPipeline({
      view: clock,
      captureUt: () => 1,
      source: source(2, true),
      sink,
      onError,
    });
    await settle();
    pipeline.dispose();
    await settle();
    expect(onError).not.toHaveBeenCalled();
  });
});
