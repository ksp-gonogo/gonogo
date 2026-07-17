/**
 * `frame-delay.ts` lifecycle + browser-support coverage. The genuine
 * per-frame delay-timing proof lives in `frame-delay.block-colour.test.ts`;
 * this file covers the memory-safety invariant (every frame closed exactly
 * once, on exactly one path) and the feature-detection / no-video-track
 * fallback `createFrameDelayStream` uses to avoid a black feed on an
 * unsupported browser.
 */

import { describe, expect, it, vi } from "vitest";
import type { DelayClockLike } from "./delayed-playout-buffer";
import {
  createFrameDelayStream,
  type FrameLike,
  type FrameSink,
  type FrameSource,
  isFrameDelaySupported,
  runFrameDelayPipeline,
} from "./frame-delay";

function manualClock(initialEdge = Number.NEGATIVE_INFINITY): DelayClockLike & {
  setEdge(v: number): void;
} {
  let edge = initialEdge;
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

/** A fake "video frame" — the minimal `FrameLike` contract, plus a spy so
 *  tests can assert `.close()` was called exactly once. */
function fakeFrame(label: string) {
  return {
    label,
    closeCount: 0,
    close() {
      this.closeCount += 1;
    },
  };
}
type FakeFrame = ReturnType<typeof fakeFrame>;

/** A source that yields a pre-supplied queue of frames one at a time, then
 *  hangs (never resolves `done: true`) until `cancel()` — mirrors a real
 *  `ReadableStreamDefaultReader` reading a live track that never ends on
 *  its own. Each `read()` call is gated on an internal "release" queue so
 *  the test controls exactly when the pump loop advances. */
function queuedSource<T extends FrameLike>(
  frames: T[],
): FrameSource<T> & {
  cancelled: boolean;
  readCount: number;
} {
  let cancelled = false;
  const state = {
    cancelled: false,
    readCount: 0,
    async read() {
      if (cancelled) return { done: true, value: undefined } as const;
      if (state.readCount >= frames.length) {
        // Simulate a track that's still open — never resolves further.
        return new Promise(() => {});
      }
      const value = frames[state.readCount];
      state.readCount += 1;
      return { done: false, value } as { done: false; value: T };
    },
    cancel() {
      cancelled = true;
      state.cancelled = true;
      return Promise.resolve();
    },
  };
  return state;
}

/** A sink that records every write in order. */
function recordingSink<T extends FrameLike>(): FrameSink<T> & {
  written: T[];
  closed: boolean;
} {
  const written: T[] = [];
  return {
    written,
    closed: false,
    write(frame: T) {
      written.push(frame);
      return Promise.resolve();
    },
    close() {
      this.closed = true;
      return Promise.resolve();
    },
  };
}

describe("isFrameDelaySupported", () => {
  it("is false in this (jsdom) test environment — no WebCodecs track-IO globals", () => {
    expect(isFrameDelaySupported()).toBe(false);
  });
});

describe("createFrameDelayStream", () => {
  it("returns null (never throws) when the browser lacks the WebCodecs track-IO APIs", () => {
    const clock = manualClock();
    const raw = { getVideoTracks: () => [{}] } as unknown as MediaStream;
    expect(() =>
      createFrameDelayStream(raw, { view: clock, captureUt: () => 0 }),
    ).not.toThrow();
    expect(
      createFrameDelayStream(raw, { view: clock, captureUt: () => 0 }),
    ).toBeNull();
  });

  it("returns null when supported but the stream has no video track", () => {
    // Minimal stand-ins just to satisfy the `typeof x !== "undefined"`
    // feature-detection check — the constructors are never invoked because
    // the no-video-track guard returns before either is called.
    vi.stubGlobal("MediaStreamTrackProcessor", class {});
    vi.stubGlobal("MediaStreamTrackGenerator", class {});
    try {
      const clock = manualClock();
      const raw = { getVideoTracks: () => [] } as unknown as MediaStream;
      expect(
        createFrameDelayStream(raw, { view: clock, captureUt: () => 0 }),
      ).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails OPEN — returns null, reports via onError, never throws — when building the processor/generator pair throws", () => {
    // Models the plausible real-world case: a build effect rebuilds on the
    // SAME track before the PRIOR pipeline's un-awaited `source.cancel()`
    // has actually released it (React StrictMode's mount→unmount→mount
    // cycle, or any dep change that isn't `raw`) — Chrome can throw
    // `InvalidStateError` from `new MediaStreamTrackProcessor(...)` because a
    // `MediaStreamTrack` may have only one processor at a time. Review
    // finding #3 (`2026-07-15-per-frame-video-delay-review.md`).
    class ThrowingProcessor {
      constructor() {
        throw new Error("InvalidStateError: track already has a processor");
      }
    }
    vi.stubGlobal("MediaStreamTrackProcessor", ThrowingProcessor);
    vi.stubGlobal("MediaStreamTrackGenerator", class {});
    try {
      const clock = manualClock();
      const raw = { getVideoTracks: () => [{}] } as unknown as MediaStream;
      const onError = vi.fn();
      let result: ReturnType<typeof createFrameDelayStream>;
      expect(() => {
        result = createFrameDelayStream(raw, {
          view: clock,
          captureUt: () => 0,
          onError,
        });
      }).not.toThrow();
      expect(result).toBeNull();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("runFrameDelayPipeline — memory safety (every frame closed exactly once)", () => {
  it("closes a released frame only after it's been written to the sink", async () => {
    const clock = manualClock(0); // edge already caught up
    const frame = fakeFrame("f1");
    const source = queuedSource<FakeFrame>([frame]);
    const sink = recordingSink<FakeFrame>();

    runFrameDelayPipeline({
      view: clock,
      captureUt: () => 0,
      source,
      sink,
      maxBufferedFrames: 10,
    });

    // Let the async pump loop's microtasks/promises settle.
    await vi.waitFor(() => {
      expect(sink.written).toEqual([frame]);
    });
    await vi.waitFor(() => {
      expect(frame.closeCount).toBe(1);
    });
  });

  it("closes a frame dropped by over-cap eviction, without ever writing it", async () => {
    const clock = manualClock(Number.NEGATIVE_INFINITY); // never releases
    const frames = [fakeFrame("a"), fakeFrame("b"), fakeFrame("c")];
    const source = queuedSource<FakeFrame>(frames);
    const sink = recordingSink<FakeFrame>();

    runFrameDelayPipeline({
      view: clock,
      captureUt: () => 1,
      source,
      sink,
      maxBufferedFrames: 2, // forces eviction on the 3rd frame
    });

    await vi.waitFor(() => {
      expect(frames[0]?.closeCount).toBe(1); // oldest evicted
    });
    expect(sink.written).toEqual([]);
    expect(frames[1]?.closeCount).toBe(0);
    expect(frames[2]?.closeCount).toBe(0);
  });

  it("closes every still-queued frame on flush(), without tearing down source/sink", async () => {
    const clock = manualClock(Number.NEGATIVE_INFINITY);
    const frames = [fakeFrame("a"), fakeFrame("b")];
    const source = queuedSource<FakeFrame>(frames);
    const sink = recordingSink<FakeFrame>();

    const pipeline = runFrameDelayPipeline({
      view: clock,
      captureUt: () => 1,
      source,
      sink,
      maxBufferedFrames: 10,
    });

    await vi.waitFor(() => {
      expect(source.readCount).toBe(2); // both frames pulled off the source
    });
    expect(frames[1]?.closeCount).toBe(0); // queued, not yet closed

    pipeline.flush();

    expect(frames[0]?.closeCount).toBe(1);
    expect(frames[1]?.closeCount).toBe(1);
    expect(sink.written).toEqual([]);
    expect(source.cancelled).toBe(false); // flush ≠ dispose — track keeps flowing
    expect(sink.closed).toBe(false);
  });

  it("closes every still-queued frame on dispose(), cancels the source, and closes the sink", async () => {
    const clock = manualClock(Number.NEGATIVE_INFINITY);
    const frames = [fakeFrame("a"), fakeFrame("b")];
    const source = queuedSource<FakeFrame>(frames);
    const sink = recordingSink<FakeFrame>();

    const pipeline = runFrameDelayPipeline({
      view: clock,
      captureUt: () => 1,
      source,
      sink,
      maxBufferedFrames: 10,
    });

    await vi.waitFor(() => {
      expect(source.readCount).toBe(2); // both frames pulled off the source
    });
    expect(frames[1]?.closeCount).toBe(0); // queued, not yet closed

    pipeline.dispose();

    expect(frames[0]?.closeCount).toBe(1);
    expect(frames[1]?.closeCount).toBe(1);
    expect(source.cancelled).toBe(true);
    expect(sink.closed).toBe(true);

    // dispose() is idempotent.
    expect(() => pipeline.dispose()).not.toThrow();
  });

  it("closes a frame that arrives from source.read() after dispose() already fired", async () => {
    const clock = manualClock(Number.NEGATIVE_INFINITY);
    let resolveRead: ((v: { done: false; value: FakeFrame }) => void) | null =
      null;
    const late = fakeFrame("late");
    const source: FrameSource<FakeFrame> & { cancelled: boolean } = {
      cancelled: false,
      read: () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      cancel() {
        this.cancelled = true;
        return Promise.resolve();
      },
    };
    const sink = recordingSink<FakeFrame>();

    const pipeline = runFrameDelayPipeline({
      view: clock,
      captureUt: () => 1,
      source,
      sink,
      maxBufferedFrames: 10,
    });

    pipeline.dispose();
    // The in-flight read() resolves only now — after teardown already ran.
    resolveRead?.({ done: false, value: late });

    await vi.waitFor(() => {
      expect(late.closeCount).toBe(1);
    });
    expect(sink.written).toEqual([]);
  });

  it("reports a rejected write via onError but still closes the frame", async () => {
    const clock = manualClock(0);
    const frame = fakeFrame("f1");
    const source = queuedSource<FakeFrame>([frame]);
    const sink: FrameSink<FakeFrame> = {
      write: () => Promise.reject(new Error("write failed")),
      close: () => Promise.resolve(),
    };
    const onError = vi.fn();

    runFrameDelayPipeline({
      view: clock,
      captureUt: () => 0,
      source,
      sink,
      maxBufferedFrames: 10,
      onError,
    });

    await vi.waitFor(() => {
      expect(frame.closeCount).toBe(1);
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});

// -- Encoded-domain frame shape (2026-07-16 encoded-transform video-delay
// work). An RTCEncodedVideoFrame has no `.close()` (a plain data object,
// no GPU/decoder resource), a `.type` of "key"/"delta", and a real
// `.data.byteLength` — this section proves the pipeline handles that shape
// correctly: no crash on the optional `close?.()` calls, `isKeyframe`/
// `frameBytes` correctly classify frames for `DelayedPlayoutBuffer`, and
// `gopSafeEviction` protects a GOP under cap pressure end-to-end.
describe("runFrameDelayPipeline — encoded frame shape (no close(), keyframe/bytes classification)", () => {
  /** Minimal stand-in for RTCEncodedVideoFrame: NO close() method, a
   *  `type` discriminant, and a byte-sized `data` payload. */
  function fakeEncodedFrame(type: "key" | "delta", byteLength: number) {
    return { type, data: new ArrayBuffer(byteLength) };
  }
  type FakeEncodedFrame = ReturnType<typeof fakeEncodedFrame>;

  it("releases and writes an encoded frame without ever calling close() (it has none)", async () => {
    const clock = manualClock(0); // edge already caught up
    const frame = fakeEncodedFrame("key", 100);
    const source = queuedSource<FakeEncodedFrame>([frame]);
    const sink = recordingSink<FakeEncodedFrame>();

    const pipeline = runFrameDelayPipeline({
      view: clock,
      captureUt: () => 0,
      source,
      sink,
      maxBufferedFrames: 10_000,
      isKeyframe: (f) => f.type === "key",
      frameBytes: (f) => f.data.byteLength,
    });

    await vi.waitFor(() => {
      expect(sink.written).toEqual([frame]);
    });
    pipeline.dispose();
  });

  it("forwards isKeyframe/frameBytes/gopSafeEviction to the buffer for every ingested frame (wiring — eviction semantics themselves are DelayedPlayoutBuffer.test.ts's gopSafeEviction suite)", async () => {
    const clock = manualClock(Number.NEGATIVE_INFINITY); // nothing releases; only ingest/classification under test
    const k1 = fakeEncodedFrame("key", 40);
    const d1 = fakeEncodedFrame("delta", 20);
    const source = queuedSource<FakeEncodedFrame>([k1, d1]);
    const sink = recordingSink<FakeEncodedFrame>();
    const isKeyframe = vi.fn((f: FakeEncodedFrame) => f.type === "key");
    const frameBytes = vi.fn((f: FakeEncodedFrame) => f.data.byteLength);

    const pipeline = runFrameDelayPipeline({
      view: clock,
      captureUt: () => 1,
      source,
      sink,
      maxBufferedFrames: 10_000,
      isKeyframe,
      frameBytes,
      gopSafeEviction: true,
    });

    await vi.waitFor(() => {
      expect(source.readCount).toBe(2);
    });

    expect(isKeyframe).toHaveBeenCalledWith(k1);
    expect(isKeyframe).toHaveBeenCalledWith(d1);
    expect(frameBytes).toHaveBeenCalledWith(k1);
    expect(frameBytes).toHaveBeenCalledWith(d1);
    // Nothing released (edge = -Infinity) — ingest/classification only.
    expect(sink.written).toEqual([]);
    pipeline.dispose();
  });

  it("defaults isKeyframe/frameBytes to false/1 when omitted — decoded backend's existing behaviour, unchanged", async () => {
    const clock = manualClock(Number.NEGATIVE_INFINITY);
    const frame = fakeFrame("f1");
    const sink = recordingSink<FakeFrame>();

    // maxBufferedFrames: 1 with the OLD default (frame-count cap, `bytes`
    // defaults to 1) means a second push evicts the first — proves
    // `frameBytes` really defaults to 1, not something encoded-shaped.
    const second = fakeFrame("f2");
    runFrameDelayPipeline({
      view: clock,
      captureUt: () => 1,
      source: queuedSource<FakeFrame>([frame, second]),
      sink,
      maxBufferedFrames: 1,
    });

    await vi.waitFor(() => {
      expect(frame.closeCount).toBe(1); // evicted (over cap), closed via onDrop
    });
    expect(sink.written).toEqual([]);
  });
});
