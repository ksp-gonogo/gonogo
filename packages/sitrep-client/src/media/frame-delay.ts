/// <reference path="./webcodecs-track-io.d.ts" />
/**
 * The per-frame video delay pipeline (Wednesday Work,
 * `2026-07-15-per-frame-video-delay.md`).
 *
 * `useDelayedPlayout` (the camera Uplink's stream hook) used to push ONE
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
 * `frame-delay.block-colour.test.ts` — the real per-frame proof that would
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
} from "./delayed-playout-buffer";
import { PresentationPacer } from "./worker/presentation-pacer";

/** Minimal contract a queued frame payload must satisfy. A WebCodecs
 *  `VideoFrame` (the decoded backend) holds GPU/decoder resources — MUST be
 *  closed exactly once, so `close` is called wherever this interface's
 *  contract is exercised. `close` is OPTIONAL because an encoded-domain
 *  frame (`RTCEncodedVideoFrame`, the encoded-transform backend,
 *  2026-07-16) holds no such resource and has no `close()` method at all —
 *  it's a plain data object; every call site here uses `data.close?.()`,
 *  a no-op for that case. Kept generic so tests can drive the pipeline with
 *  a lightweight fake instead of a real browser. */
export interface FrameLike {
  close?(): void;
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
  /** Frame-count cap — see module docstring. Defaults to 300. Encoded
   *  backends should size this as a real byte cap (paired with `frameBytes`
   *  below) rather than a frame count — see `attachEncodedFrameDelay`'s doc. */
  maxBufferedFrames?: number;
  /** Non-fatal pipeline errors (a read/write rejection) — reported here,
   *  never thrown across the internal pump loop. */
  onError?(error: unknown): void;
  /** Classify a frame read off `source` as a keyframe, forwarded to
   *  `DelayedPlayoutBuffer`'s `keyframe` field. Defaults to `() => false` —
   *  correct for decoded `VideoFrame`s (no GOP dependency, see
   *  `DelayedPlayoutBuffer.gopSafeEviction`'s doc). Encoded backends should
   *  supply `(f) => f.type === "key"`. */
  isKeyframe?(frame: T): boolean;
  /** Byte-size estimate for cap accounting, forwarded to
   *  `DelayedPlayoutBuffer`'s `bytes` field. Defaults to `() => 1` (a
   *  frame-count cap). Encoded backends should supply the real payload
   *  size, e.g. `(f) => f.data.byteLength`. */
  frameBytes?(frame: T): number;
  /** Forwarded to `DelayedPlayoutBuffer` — see its own doc. MUST be `true`
   *  for encoded video (GOP-dependent); leave unset (the default) for
   *  decoded video. */
  gopSafeEviction?: boolean;
  /**
   * Opt into the presentation pacer (cross-browser video-delay
   * design, 2026-07-16, finding F3 + "Paced release" — see
   * `worker/presentation-pacer.ts`'s module doc for the full rationale).
   * Omit (the default) for the original behaviour: each released frame is
   * written to `sink` immediately, synchronously, on release — exactly
   * what every pre-existing test in this file and
   * `frame-delay.block-colour.test.ts` exercises.
   *
   * When supplied, released frames are queued into a `PresentationPacer`
   * instead, spaced by their own UT deltas rather than dumped in a burst.
   * The caller MUST drive `pipeline.tickPacing(nowWall)` periodically (the
   * Chrome main-thread backend from `requestAnimationFrame`; the
   * worker-hosted backend from its own ~60Hz clock-poll loop) — this
   * module deliberately never reads a wall clock itself, matching the
   * "injected clock, no bench in the engine" testing convention the rest
   * of this pipeline already follows.
   */
  pacing?: {
    /** See `PresentationPacerOptions.maxBacklogSeconds`. */
    maxBacklogSeconds: number;
  };
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
  /** No-op when `pacing` wasn't supplied to `runFrameDelayPipeline`.
   *  Otherwise drains any presentation due at `nowWall` (wall-clock
   *  seconds, same basis the caller's own clock reads) through the
   *  pacer — see `pacing`'s doc above. */
  tickPacing(nowWall: number): void;
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

  const writeAndClose = (data: T) => {
    opts.sink
      .write(data)
      .catch((err) => opts.onError?.(err))
      .finally(() => {
        data.close?.();
      });
  };

  // See `FrameDelayPipelineOptions.pacing`'s doc: omitted (the default)
  // preserves the exact pre-pacer behaviour every existing test here
  // exercises — write-and-close synchronously, on release.
  const pacer = opts.pacing
    ? new PresentationPacer<T>({
        maxBacklogSeconds: opts.pacing.maxBacklogSeconds,
        onPresent: (f) => writeAndClose(f.data),
        onSkip: (f) => f.data.close?.(),
      })
    : null;

  const buffer = new DelayedPlayoutBuffer<T>({
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
 * Drives `tickPacing` on a ~60Hz loop until stopped — `requestAnimationFrame`
 * where available (the real main thread), a plain `setTimeout(16)` fallback
 * otherwise (a worker context has no `requestAnimationFrame`; nor does a
 * non-browser test environment). Shared by the main-thread backend
 * (`createFrameDelayStream`, below) and the worker-hosted backend
 * (`worker/`), so there's one implementation of "how often do we drain the
 * pacer" — mirrors `ViewClock.onFrame`'s own rAF/setTimeout duality.
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

/** True when the browser exposes the WebCodecs track-IO APIs the real
 *  pipeline needs. See module docstring re: browser support. */
export function isFrameDelaySupported(): boolean {
  return (
    typeof MediaStreamTrackProcessor !== "undefined" &&
    typeof MediaStreamTrackGenerator !== "undefined"
  );
}

/** Default backlog threshold for the main-thread backend's presentation
 *  pacer (see `runFrameDelayPipeline`'s `pacing` option) — generous enough
 *  to never trip during normal sample-clamped bursts (telemetry confirms
 *  at up to ~10Hz, i.e. ~100ms between edge steps) while still catching a
 *  genuine stall (a backgrounded tab, GC pause, etc.) well before it grows
 *  into visible added latency. */
const DEFAULT_PACING_MAX_BACKLOG_SECONDS = 0.5;

export interface CreateFrameDelayStreamOptions {
  view: DelayClockLike;
  captureUt(): number;
  maxBufferedFrames?: number;
  onError?(error: unknown): void;
  /** Override the presentation pacer's backlog threshold — see
   *  `DEFAULT_PACING_MAX_BACKLOG_SECONDS`. Pacing itself can't be disabled
   *  here: this backend always paces (that's the actual jank fix — see
   *  `worker/presentation-pacer.ts`'s module doc), only the threshold is
   *  tunable. */
  maxPacingBacklogSeconds?: number;
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
 * isn't possible here — unsupported browser, `raw` has no video track, or
 * building the processor/generator pair threw (e.g. a same-track rebuild
 * racing the prior pipeline's un-awaited `cancel()` — see the try/catch
 * below) — so the caller can fall back to live passthrough instead of a
 * black feed or an escaped exception.
 */
export function createFrameDelayStream(
  raw: MediaStream,
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

    // Drive the pacer from a ~60Hz loop for as long as this pipeline lives
    // — the F3 jank fix applies here too (main-thread Breakout Box has no
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
    // `dispose()`, never awaited — see `runFrameDelayPipeline`'s own
    // `dispose`). When a build effect rebuilds on the SAME track before that
    // release has actually landed — React StrictMode's mount→unmount→mount
    // cycle, or any effect dep change that isn't `raw` — Chrome can throw
    // `InvalidStateError` ("a MediaStreamTrack may only have one processor
    // at a time"). Treat it exactly like every other can't-build-a-pipeline
    // case: report via `onError` and return null so the caller falls back to
    // live passthrough instead of the throw escaping the effect.
    opts.onError?.(err);
    return null;
  }
}
