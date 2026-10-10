/// <reference path="./webcodecs-track-io.d.ts" />
/**
 * The per-frame video delay pipeline.
 *
 * Delaying at the `MediaStream` *reference* level, one keyframe per stream, is
 * not enough: a reference changes only on a camera switch or reconnect, so only
 * *when a feed became visible* is delayed, while ongoing motion inside that
 * stream plays live. This module reads the real video
 * track frame-by-frame (WebCodecs "Breakout Box": `MediaStreamTrackProcessor`
 * / `MediaStreamTrackGenerator`, see `webcodecs-track-io.d.ts`), stamps EACH
 * frame with the live interpolated capture UT, and gates release through
 * the SAME `DelayedPlayoutBuffer` telemetry uses (never `arrival + delay`,
 * only `confirmedEdgeUt()`, the single-authority guarantee).
 *
 * `runFrameDelayPipeline` is the pure engine: deliberately decoupled from
 * the real WebCodecs constructors (source/sink are the minimal
 * `ReadableStreamDefaultReader`/`WritableStreamDefaultWriter` shapes, which
 * a real processor/generator satisfy directly with no adapter) so it can be
 * driven with synthetic frames + a manual clock in
 * `frame-delay.block-colour.test.ts`: the real per-frame proof that would
 * have caught the original gap. `createFrameDelayStream` is the thin
 * browser-facing wrapper that supplies the real objects.
 *
 * Browser support: `MediaStreamTrackProcessor`/`Generator` are Chromium-only
 * as of writing. `isFrameDelaySupported()` feature-detects, and the caller
 * (the camera feed) tries the worker backends in `worker/` when this one is
 * unsupported. When none can delay the feed it shows no video: a feed that
 * cannot be delayed is never shown live.
 *
 * Buffer cap: `DelayedPlayoutBuffer`'s existing `maxBufferedBytes` cap
 * doubles here as a FRAME-COUNT cap (every queued item counts `bytes: 1`,
 * real per-frame byte sizes aren't tracked). Default 300 frames is ~10s of
 * headroom at 30fps, comfortably above the realistic multi-second delay
 * range this app models; over-cap eviction drops the oldest queued frame
 * (closing it via `onDrop`) rather than growing unboundedly.
 */

import {
  type DelayClockLike,
  DelayedPlayoutBuffer,
} from "./delayed-playout-buffer";
import { PresentationPacer } from "./worker/presentation-pacer";

/**
 * A frame the delay can hold. A decoded `VideoFrame` holds browser resources
 * and must be closed exactly once, so the delay calls `close` on every frame it
 * is done with. An encoded frame has nothing to close, so `close` is optional.
 *
 * @category Delayed video
 */
export interface FrameLike {
  /** Releases the frame's resources, when it has any. */
  close?(): void;
}

/**
 * Where the delay reads frames from: a `ReadableStreamDefaultReader`, such as
 * the one `MediaStreamTrackProcessor.readable.getReader()` returns.
 *
 * @category Delayed video
 */
export type FrameSource<Frame extends FrameLike> = Pick<
  ReadableStreamDefaultReader<Frame>,
  "read" | "cancel"
>;

/**
 * Where the delay writes frames to: a `WritableStreamDefaultWriter`, such as
 * the one `MediaStreamTrackGenerator.writable.getWriter()` returns.
 *
 * @category Delayed video
 */
export type FrameSink<Frame extends FrameLike> = Pick<
  WritableStreamDefaultWriter<Frame>,
  "write" | "close"
>;

/**
 * Options for `runFrameDelayPipeline`.
 *
 * @category Delayed video
 */
export interface FrameDelayPipelineOptions<Frame extends FrameLike> {
  /**
   * The app's view clock, the same one telemetry is read by.
   */
  view: DelayClockLike;
  /**
   * Returns the UT to stamp a frame with, called once for each frame as it is
   * read from `source`.
   */
  captureUt(): number;
  /** Where frames are read from. */
  source: FrameSource<Frame>;
  /** Where released frames are written. */
  sink: FrameSink<Frame>;
  /**
   * The most frames to hold before dropping the oldest. Defaults to 300. With
   * `frameBytes` supplied, the cap counts bytes instead.
   */
  maxBufferedFrames?: number;
  /** Non-fatal pipeline errors (a read/write rejection), reported here,
   *  never thrown across the internal pump loop. */
  onError?(error: unknown): void;
  /**
   * Whether a frame is a keyframe. Defaults to never, which suits decoded
   * frames; for encoded video, supply `(f) => f.type === "key"`.
   */
  isKeyframe?(frame: Frame): boolean;
  /**
   * A frame's size for the cap. Defaults to 1, so the cap counts frames; for
   * encoded video, supply `(f) => f.data.byteLength`.
   */
  frameBytes?(frame: Frame): number;
  /**
   * Passed to {@link DelayedPlayoutBuffer}: `true` for encoded video, unset for
   * decoded.
   */
  gopSafeEviction?: boolean;
  /**
   * Spaces released frames out by their own UT intervals rather than writing
   * them at once (see {@link PresentationPacer}). Unset, each frame is written
   * as it is released. When set, call `pipeline.tickPacing(nowWall)` about 60
   * times a second, as {@link startPacingTicker} does.
   */
  pacing?: {
    /** See `PresentationPacerOptions.maxBacklogSeconds`. */
    maxBacklogSeconds: number;
  };
}

/**
 * A running frame delay pipeline, as `runFrameDelayPipeline` returns it.
 *
 * @category Delayed video
 */
export interface FrameDelayPipeline {
  /** Drop (closing) whatever's currently queued, WITHOUT tearing down
   *  source/sink: the timeline-reset case (revert/quickload/scene reload): the
   *  track keeps flowing, only the pre-reset backlog is discarded so it can
   *  never surface once the clock sweeps back past those UTs post-reset. */
  flush(): void;
  /** Stop reading, close the sink, and drop (closing) anything still
   *  queued. Idempotent: safe to call more than once. */
  dispose(): void;
  /** No-op when `pacing` wasn't supplied to `runFrameDelayPipeline`.
   *  Otherwise drains any presentation due at `nowWall` (wall-clock
   *  seconds, same basis the caller's own clock reads) through the
   *  pacer: see `pacing`'s doc above. */
  tickPacing(nowWall: number): void;
}

const DEFAULT_MAX_BUFFERED_FRAMES = 300; // ~10s @ 30fps; see module docstring

/**
 * Reads frames from `source`, holds each until the clock reaches its UT, and
 * writes it to `sink`. Every frame read is closed exactly once: after it is
 * written, when it is dropped (over the buffer's cap, on `flush()`, or still
 * held at `dispose()`), or at once if it arrives after `dispose()`.
 *
 * @category Delayed video
 */
export function runFrameDelayPipeline<Frame extends FrameLike>(
  opts: FrameDelayPipelineOptions<Frame>,
): FrameDelayPipeline {
  let disposed = false;

  const writeAndClose = (data: Frame) => {
    opts.sink
      .write(data)
      .catch((err) => opts.onError?.(err))
      .finally(() => {
        data.close?.();
      });
  };

  // See `FrameDelayPipelineOptions.pacing`'s doc: omitted (the default)
  // preserves the exact pre-pacer behaviour every existing test here
  // exercises: write-and-close synchronously, on release.
  const pacer = opts.pacing
    ? new PresentationPacer<Frame>({
        maxBacklogSeconds: opts.pacing.maxBacklogSeconds,
        onPresent: (f) => writeAndClose(f.data),
        onSkip: (f) => f.data.close?.(),
      })
    : null;

  const buffer = new DelayedPlayoutBuffer<Frame>({
    view: opts.view,
    maxBufferedBytes: opts.maxBufferedFrames ?? DEFAULT_MAX_BUFFERED_FRAMES,
    gopSafeEviction: opts.gopSafeEviction,
    onRelease: (frame) => {
      const data = frame.data;
      if (!data) return;
      if (pacer) {
        pacer.submit({ ut: frame.ut, data });
      } else {
        writeAndClose(data);
      }
    },
    onDrop: (frame) => {
      frame.data?.close?.();
    },
  });

  async function pump(): Promise<void> {
    while (!disposed) {
      let result: ReadableStreamReadResult<Frame>;
      try {
        result = await opts.source.read();
      } catch (err) {
        opts.onError?.(err);
        return;
      }
      if (result.done) return;
      const frame = result.value;
      if (disposed) {
        frame.close?.();
        return;
      }
      buffer.push({
        ut: opts.captureUt(),
        keyframe: opts.isKeyframe?.(frame) ?? false,
        data: frame,
        bytes: opts.frameBytes?.(frame) ?? 1,
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
      pacer?.dispose();
      void Promise.resolve(opts.source.cancel()).catch(() => {});
      void Promise.resolve(opts.sink.close()).catch(() => {});
    },
    tickPacing(nowWall: number) {
      pacer?.tick(nowWall);
    },
  };
}

/**
 * Calls `tickPacing` about 60 times a second until the returned function is
 * called: on each animation frame where there is one, and every 16 ms where
 * there is not, as in a worker.
 *
 * @category Delayed video
 */
export function startPacingTicker(
  tickPacing: (nowWall: number) => void,
  nowWall: () => number = () => performance.now() / 1000,
): () => void {
  const hasRaf = typeof requestAnimationFrame === "function";
  let cancelled = false;
  let handle: number | ReturnType<typeof setTimeout>;

  const tick = () => {
    if (cancelled) return;
    tickPacing(nowWall());
    handle = hasRaf ? requestAnimationFrame(tick) : setTimeout(tick, 16);
  };
  handle = hasRaf ? requestAnimationFrame(tick) : setTimeout(tick, 16);

  return () => {
    cancelled = true;
    if (hasRaf) cancelAnimationFrame(handle as number);
    else clearTimeout(handle as ReturnType<typeof setTimeout>);
  };
}

/**
 * Whether this browser has the WebCodecs track APIs
 * (`MediaStreamTrackProcessor` and `MediaStreamTrackGenerator`) that
 * {@link createFrameDelayStream} needs.
 *
 * @category Delayed video
 */
export function isFrameDelaySupported(): boolean {
  return (
    typeof MediaStreamTrackProcessor !== "undefined" &&
    typeof MediaStreamTrackGenerator !== "undefined"
  );
}

/** Default backlog threshold for the main-thread backend's presentation
 *  pacer (see `runFrameDelayPipeline`'s `pacing` option): generous enough
 *  to never trip during normal sample-clamped bursts (telemetry confirms
 *  at up to ~10Hz, i.e. ~100ms between edge steps) while still catching a
 *  genuine stall (a backgrounded tab, GC pause, etc.) well before it grows
 *  into visible added latency. */
const DEFAULT_PACING_MAX_BACKLOG_SECONDS = 0.5;

/**
 * Options for `createFrameDelayStream`.
 *
 * @category Delayed video
 */
export interface CreateFrameDelayStreamOptions {
  /** The clock the delay follows. */
  view: DelayClockLike;
  /** Returns the UT to stamp a frame with, called for each frame as it is read. */
  captureUt(): number;
  /** The most frames to hold before dropping the oldest. */
  maxBufferedFrames?: number;
  /** Called with a non-fatal pipeline error. */
  onError?(error: unknown): void;
  /** Override the presentation pacer's backlog threshold: see
   *  `DEFAULT_PACING_MAX_BACKLOG_SECONDS`. Pacing itself can't be disabled
   *  here: this backend always paces (that's the actual jank fix; see
   *  `worker/presentation-pacer.ts`'s module doc), only the threshold is
   *  tunable. */
  maxPacingBacklogSeconds?: number;
}

/**
 * A delayed copy of a video stream, as `createFrameDelayStream` returns it.
 *
 * @category Delayed video
 */
export interface FrameDelayStream {
  /** The delayed output: feed this to a `<video>`'s `srcObject`. */
  stream: MediaStream;
  /** Tears the stream down. */
  dispose(): void;
  /** Drops the frames it holds. */
  flush(): void;
}

/**
 * The whole of `MediaStream` this reads. Narrower than the DOM type on purpose:
 * a `MediaStream` cannot be constructed outside a browser, so a test standing in
 * for one would otherwise have to be minted through an assertion.
 */
export interface VideoTrackSource {
  getVideoTracks(): MediaStreamTrack[];
}

/**
 * A delayed copy of the first video track of `raw`, the `MediaStream` as it
 * arrived, such as the one a WebRTC connection hands over. Returns `null`, and never
 * throws, when that cannot be built here: the browser lacks the APIs, `raw`
 * has no video track, or building the track pipeline threw. Show no video in
 * that case, and say the delay is unavailable. Never show `raw`: it is the
 * live picture, ahead of everything else the operator is looking at.
 *
 * @category Delayed video
 */
export function createFrameDelayStream(
  raw: VideoTrackSource,
  opts: CreateFrameDelayStreamOptions,
): FrameDelayStream | null {
  if (!isFrameDelaySupported()) return null;
  const track = raw.getVideoTracks()[0];
  if (!track) return null;

  try {
    const processor = new MediaStreamTrackProcessor({ track });
    const generator = new MediaStreamTrackGenerator({ kind: "video" });

    const pipeline = runFrameDelayPipeline<VideoFrame>({
      view: opts.view,
      captureUt: opts.captureUt,
      maxBufferedFrames: opts.maxBufferedFrames,
      source: processor.readable.getReader(),
      sink: generator.writable.getWriter(),
      onError: opts.onError,
      pacing: {
        maxBacklogSeconds:
          opts.maxPacingBacklogSeconds ?? DEFAULT_PACING_MAX_BACKLOG_SECONDS,
      },
    });

    // Drive the pacer from a ~60Hz loop for as long as this pipeline lives,
    // the F3 jank fix applies here too (main-thread Breakout Box has no
    // sample-rate limitation of its own; the stutter comes from
    // `ViewClock.confirmedEdgeUt()`'s sample clamp, which affects every
    // backend equally). `requestAnimationFrame` is always available on the
    // real main thread this backend runs on; the `setTimeout` fallback only
    // matters for a non-browser/SSR-like test context.
    const stopTicking = startPacingTicker(pipeline.tickPacing);

    return {
      stream: new MediaStream([generator]),
      dispose: () => {
        stopTicking();
        pipeline.dispose();
      },
      flush: pipeline.flush,
    };
  } catch (err) {
    // Fail OPEN, not through: pipeline construction runs synchronously right
    // after the PRIOR pipeline's un-awaited `source.cancel()` (fired from
    // `dispose()`, never awaited: see `runFrameDelayPipeline`'s own
    // `dispose`). When a build effect rebuilds on the SAME track before that
    // release has actually landed, React StrictMode's mount→unmount→mount
    // cycle, or any effect dep change that isn't `raw`, Chrome can throw
    // `InvalidStateError` ("a MediaStreamTrack may only have one processor
    // at a time"). Treat it exactly like every other can't-build-a-pipeline
    // case: report via `onError` and return null so the caller falls back to
    // live passthrough instead of the throw escaping the effect.
    opts.onError?.(err);
    return null;
  }
}
