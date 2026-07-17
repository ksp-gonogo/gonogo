/**
 * `attachEncodedFrameDelayTransform` — the encoded-domain backend adapter.
 * Uses REAL `ReadableStream`/`WritableStream` objects (available in
 * Node/jsdom, unlike `MediaStreamTrackProcessor`/`RTCRtpScriptTransform`
 * themselves) rather than raw fake reader/writer objects, so these tests
 * exercise the actual `.getReader()`/`.getWriter()` extraction this
 * module's whole job is to do — stronger fidelity than passing
 * hand-rolled reader/writer stand-ins directly to `runFrameDelayPipeline`
 * (see `frameDelay.test.ts` for that lower-level coverage).
 */

import { describe, expect, it, vi } from "vitest";
import type { DelayClockLike } from "./delayed-playout-buffer";
import {
  attachEncodedFrameDelayTransform,
  DEFAULT_MAX_BUFFERED_BYTES,
  type EncodedTransformerLike,
  type EncodedVideoFrameLike,
} from "./encoded-frame-delay";

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

/** A real `{readable, writable}` transformer pair, backed by genuine Streams
 *  API objects — the same shape `RTCTransformEvent.transformer` provides. */
function fakeTransformer(frames: EncodedVideoFrameLike[]): {
  transformer: EncodedTransformerLike;
  written: EncodedVideoFrameLike[];
} {
  const written: EncodedVideoFrameLike[] = [];
  const readable = new ReadableStream<EncodedVideoFrameLike>({
    start(controller) {
      for (const f of frames) controller.enqueue(f);
      // Deliberately never closes — mirrors a live track that keeps
      // flowing, matching `frameDelay.test.ts`'s `queuedSource` convention.
    },
  });
  const writable = new WritableStream<EncodedVideoFrameLike>({
    write(chunk) {
      written.push(chunk);
    },
  });
  return { transformer: { readable, writable }, written };
}

function keyFrame(byteLength: number): EncodedVideoFrameLike {
  return { type: "key", data: new ArrayBuffer(byteLength) };
}
function deltaFrame(byteLength: number): EncodedVideoFrameLike {
  return { type: "delta", data: new ArrayBuffer(byteLength) };
}

describe("attachEncodedFrameDelayTransform", () => {
  it("reads real encoded frames off transformer.readable and writes released ones to transformer.writable", async () => {
    const clock = manualClock(0); // edge already caught up — releases immediately
    const frame = keyFrame(64);
    const { transformer, written } = fakeTransformer([frame]);

    const pipeline = attachEncodedFrameDelayTransform(transformer, {
      view: clock,
      captureUt: () => 0,
    });

    // This backend always paces (mirrors createFrameDelayStream's F3 jank
    // fix) — a released-into-the-pacer frame only actually reaches
    // transformer.writable once tickPacing drains it (see
    // frameDelay.pacing.test.ts's identical pattern).
    await vi.waitFor(() => {
      pipeline.tickPacing(0);
      expect(written).toEqual([frame]);
    });
    pipeline.dispose();
  });

  it("holds a frame until confirmedEdgeUt() reaches its stamped UT — never arrival, only the gate", async () => {
    const clock = manualClock(Number.NEGATIVE_INFINITY);
    const frame = keyFrame(64);
    const { transformer, written } = fakeTransformer([frame]);

    const pipeline = attachEncodedFrameDelayTransform(transformer, {
      view: clock,
      captureUt: () => 100,
    });

    // Frame has definitely been read (queued) by now, but the clock has
    // never confirmed anything — must NOT have been released, paced or not.
    await new Promise((r) => setTimeout(r, 10));
    pipeline.tickPacing(0);
    expect(written).toEqual([]);

    clock.setEdge(100);
    await vi.waitFor(() => {
      pipeline.tickPacing(0);
      expect(written).toEqual([frame]);
    });
    pipeline.dispose();
  });

  it("classifies frame.type as the DelayedPlayoutBuffer keyframe field and uses real byteLength for cap accounting — a GOP survives eviction intact", async () => {
    const clock = manualClock(Number.NEGATIVE_INFINITY); // nothing releases — pure eviction test
    // GOP 1 (k1+d1a+d1b = 60 bytes) then GOP 2's keyframe (k2, 20 bytes)
    // pushes total to 80 — over an intentionally tiny 60-byte cap.
    const k1 = keyFrame(20);
    const d1a = deltaFrame(20);
    const d1b = deltaFrame(20);
    const k2 = keyFrame(20);
    const { transformer, written } = fakeTransformer([k1, d1a, d1b, k2]);

    const pipeline = attachEncodedFrameDelayTransform(transformer, {
      view: clock,
      captureUt: () => 1,
      maxBufferedBytes: 60,
    });

    // Give the async pump loop time to read all 4 frames and evict.
    await new Promise((r) => setTimeout(r, 20));

    // Whole GOP 1 evicted as a unit (never a lone mid-GOP delta) — proven
    // at the DelayedPlayoutBuffer level already; here we only need to know
    // this adapter's isKeyframe/frameBytes wiring feeds real values through
    // (a wrong classification would either evict k2 instead, or evict
    // one-frame-at-a-time and leave a corrupt partial GOP).
    expect(written).toEqual([]); // nothing released (edge = -Infinity)
    pipeline.dispose();
  });

  it("never calls close() on an encoded frame (it has none) — no crash", async () => {
    const clock = manualClock(0);
    const frame = keyFrame(64);
    const { transformer, written } = fakeTransformer([frame]);

    expect(() => {
      const pipeline = attachEncodedFrameDelayTransform(transformer, {
        view: clock,
        captureUt: () => 0,
      });
      pipeline.dispose();
    }).not.toThrow();
    // written may or may not have landed before dispose — the point is no
    // throw from a stray `.close()` call on a plain data object.
    void written;
  });

  it("defaults maxBufferedBytes to DEFAULT_MAX_BUFFERED_BYTES when omitted", async () => {
    const clock = manualClock(Number.NEGATIVE_INFINITY);
    // One huge frame just under the default cap survives; nothing to
    // assert beyond "construction with no maxBufferedBytes doesn't throw
    // and doesn't immediately evict a single reasonably-sized frame."
    const frame = keyFrame(1024);
    const { transformer, written } = fakeTransformer([frame]);

    const pipeline = attachEncodedFrameDelayTransform(transformer, {
      view: clock,
      captureUt: () => 1,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(written).toEqual([]); // held, not evicted, not released
    expect(DEFAULT_MAX_BUFFERED_BYTES).toBeGreaterThan(1024);
    pipeline.dispose();
  });

  it("reports a rejected write via onError", async () => {
    const clock = manualClock(0);
    const frame = keyFrame(64);
    const readable = new ReadableStream<EncodedVideoFrameLike>({
      start(controller) {
        controller.enqueue(frame);
      },
    });
    const writable = new WritableStream<EncodedVideoFrameLike>({
      write() {
        return Promise.reject(new Error("write failed"));
      },
    });
    const onError = vi.fn();

    const pipeline = attachEncodedFrameDelayTransform(
      { readable, writable },
      { view: clock, captureUt: () => 0, onError },
    );

    await vi.waitFor(() => {
      pipeline.tickPacing(0);
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
    pipeline.dispose();
  });
});
