/**
 * The per-frame video delay pipeline (Wednesday Work,
 * `2026-07-15-kerbcast-per-frame-video-delay.md`).
 *
 * `useDelayedPlayout` (`hooks/useKerbcastStream.ts`) used to push ONE
 * keyframe per raw `MediaStream` *reference* — i.e. only on a camera switch
 * / reconnect — so only *when a feed became visible* was delayed; ongoing
 * motion inside that stream played live. This module reads the real video
 * track frame-by-frame (WebCodecs "Breakout Box" — `MediaStreamTrackProcessor`
 * / `MediaStreamTrackGenerator`, see `webcodecs-track-io.d.ts`), stamps EACH
 * frame with the live interpolated capture UT, and gates release through
 * the SAME `DelayedPlayoutBuffer` telemetry uses (never `arrival + delay` —
 * only `confirmedEdgeUt()`, the single-authority guarantee).
 *
 * `runFrameDelayPipeline` is the pure engine: deliberately decoupled from
 * the real WebCodecs constructors (source/sink are the minimal
 * `ReadableStreamDefaultReader`/`WritableStreamDefaultWriter` shapes, which
 * a real processor/generator satisfy directly with no adapter) so it can be
 * driven with synthetic frames + a manual clock in
 * `frameDelay.blockColour.test.ts` — the real per-frame proof that would
 * have caught the original gap. `createFrameDelayStream` is the thin
 * browser-facing wrapper that supplies the real objects.
 *
 * Browser support: `MediaStreamTrackProcessor`/`Generator` are Chromium-only
 * as of writing. `isFrameDelaySupported()` feature-detects; the caller
 * (`useDelayedPlayout`) falls back to live passthrough — never a black
 * feed — when unsupported, or when `raw` has no video track. This is a
 * documented, flagged trade-off (not a silent drop): Safari/Firefox get the
 * feed live, undelayed, until/unless a canvas-based fallback (mechanism B
 * in the spec) is built.
 *
 * Buffer cap: `DelayedPlayoutBuffer`'s existing `maxBufferedBytes` cap
 * doubles here as a FRAME-COUNT cap (every queued item counts `bytes: 1` —
 * real per-frame byte sizes aren't tracked). Default 300 frames is ~10s of
 * headroom at 30fps, comfortably above the realistic multi-second delay
 * range this app models; over-cap eviction drops the oldest queued frame
 * (closing it via `onDrop`) rather than growing unboundedly.
 */

import {
  type DelayClockLike,
  DelayedPlayoutBuffer,
} from "./DelayedPlayoutBuffer";

/** Minimal contract a queued frame payload must satisfy. Real usage is a
 *  WebCodecs `VideoFrame` (holds GPU/decoder resources — MUST be closed
 *  exactly once); kept generic so tests can drive the pipeline with a
 *  lightweight fake instead of a real browser. */
export interface FrameLike {
  close(): void;
}

/** The pull side — satisfied directly by a real
 *  `ReadableStreamDefaultReader<VideoFrame>` (from
 *  `MediaStreamTrackProcessor.readable.getReader()`); tests pass a fake
 *  implementing just this shape. */
export type FrameSource<T extends FrameLike> = Pick<
  ReadableStreamDefaultReader<T>,
  "read" | "cancel"
>;

/** The push side — satisfied directly by a real
 *  `WritableStreamDefaultWriter<VideoFrame>` (from
 *  `MediaStreamTrackGenerator.writable.getWriter()`); tests pass a fake. */
export type FrameSink<T extends FrameLike> = Pick<
  WritableStreamDefaultWriter<T>,
  "write" | "close"
>;

export interface FrameDelayPipelineOptions<T extends FrameLike> {
  /** THE delay clock — the same instance telemetry reads. */
  view: DelayClockLike;
  /** Capture-UT to stamp EACH incoming frame with — called once per frame
   *  read off `source`, not once per stream (contrast the old design). */
  captureUt(): number;
  source: FrameSource<T>;
  sink: FrameSink<T>;
  /** Frame-count cap — see module docstring. Defaults to 300. */
  maxBufferedFrames?: number;
  /** Non-fatal pipeline errors (a read/write rejection) — reported here,
   *  never thrown across the internal pump loop. */
  onError?(error: unknown): void;
}

export interface FrameDelayPipeline {
  /** Drop (closing) whatever's currently queued, WITHOUT tearing down
   *  source/sink — the timeline-reset case (revert/quickload/scene
   *  reload): the track keeps flowing, only the stale pre-reset backlog is
   *  discarded so it can never surface once the clock sweeps back past
   *  those UTs post-reset. */
  flush(): void;
  /** Stop reading, close the sink, and drop (closing) anything still
   *  queued. Idempotent — safe to call more than once. */
  dispose(): void;
}

const DEFAULT_MAX_BUFFERED_FRAMES = 300; // ~10s @ 30fps — see module docstring

/**
 * The per-frame delay engine. See module docstring for the design and the
 * memory-safety invariant: every frame pulled from `source` is closed
 * exactly once — written-then-closed (release), dropped-then-closed
 * (over-cap eviction / `flush()` / leftovers at `dispose()`), or
 * closed-immediately if it arrives after `dispose()` already fired.
 */
export function runFrameDelayPipeline<T extends FrameLike>(
  opts: FrameDelayPipelineOptions<T>,
): FrameDelayPipeline {
  let disposed = false;

  const buffer = new DelayedPlayoutBuffer<T>({
    view: opts.view,
    maxBufferedBytes: opts.maxBufferedFrames ?? DEFAULT_MAX_BUFFERED_FRAMES,
    onRelease: (frame) => {
      const data = frame.data;
      if (!data) return;
      opts.sink
        .write(data)
        .catch((err) => opts.onError?.(err))
        .finally(() => {
          data.close();
        });
    },
    onDrop: (frame) => {
      frame.data?.close();
    },
  });

  async function pump(): Promise<void> {
    while (!disposed) {
      let result: ReadableStreamReadResult<T>;
      try {
        result = await opts.source.read();
      } catch (err) {
        opts.onError?.(err);
        return;
      }
      if (result.done) return;
      const frame = result.value;
      if (disposed) {
        frame.close();
        return;
      }
      buffer.push({
        ut: opts.captureUt(),
        keyframe: false,
        data: frame,
        bytes: 1,
      });
    }
  }
  void pump();

  return {
    flush() {
      buffer.flush();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      buffer.dispose();
      void Promise.resolve(opts.source.cancel()).catch(() => {});
      void Promise.resolve(opts.sink.close()).catch(() => {});
    },
  };
}

/** True when the browser exposes the WebCodecs track-IO APIs the real
 *  pipeline needs. See module docstring re: browser support. */
export function isFrameDelaySupported(): boolean {
  return (
    typeof MediaStreamTrackProcessor !== "undefined" &&
    typeof MediaStreamTrackGenerator !== "undefined"
  );
}

export interface CreateFrameDelayStreamOptions {
  view: DelayClockLike;
  captureUt(): number;
  maxBufferedFrames?: number;
  onError?(error: unknown): void;
}

export interface FrameDelayStream {
  /** The delayed output — feed this to a `<video>`'s `srcObject`. */
  stream: MediaStream;
  dispose(): void;
  flush(): void;
}

/**
 * Browser-facing wrapper: builds a real `MediaStreamTrackProcessor` →
 * `runFrameDelayPipeline` → `MediaStreamTrackGenerator` chain for `raw`'s
 * first video track. Returns `null` (never throws) when per-frame delay
 * isn't possible here — unsupported browser, or `raw` has no video track —
 * so the caller can fall back to live passthrough instead of a black feed.
 */
export function createFrameDelayStream(
  raw: MediaStream,
  opts: CreateFrameDelayStreamOptions,
): FrameDelayStream | null {
  if (!isFrameDelaySupported()) return null;
  const track = raw.getVideoTracks()[0];
  if (!track) return null;

  const processor = new MediaStreamTrackProcessor({ track });
  const generator = new MediaStreamTrackGenerator({ kind: "video" });

  const pipeline = runFrameDelayPipeline<VideoFrame>({
    view: opts.view,
    captureUt: opts.captureUt,
    maxBufferedFrames: opts.maxBufferedFrames,
    source: processor.readable.getReader(),
    sink: generator.writable.getWriter(),
    onError: opts.onError,
  });

  return {
    stream: new MediaStream([generator]),
    dispose: pipeline.dispose,
    flush: pipeline.flush,
  };
}
