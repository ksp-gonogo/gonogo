/**
 * The encoded-domain per-frame video delay backend, from the encoded-transform
 * cross-browser video-delay work of 2026-07-16, implementing the capture-UT
 * mapping that work validated per engine.
 *
 * UNLIKE `frame-delay.ts`'s decoded backend (`MediaStreamTrackProcessor` /
 * `MediaStreamTrackGenerator`: Chromium-only on the main thread), this
 * backend attaches to the standard, cross-browser
 * `RTCRtpScriptTransform`/`RTCTransformEvent.transformer` shape: a
 * `{readable, writable}` pair of ENCODED `RTCEncodedVideoFrame`s, delivered
 * pre-decode. Empirically confirmed to hold a real multi-second delay with
 * zero drops on Chromium, Firefox, and WebKit (spike report), gated on a
 * REAL `confirmedEdgeUt()` computation rather than arrival+fixedDelayMs
 * (Phase-1 report): this module is the production wiring of that proof.
 *
 * `attachEncodedFrameDelayTransform` is a thin adapter: it reuses
 * `runFrameDelayPipeline` VERBATIM ("a new backend
 * is a new source/sink pair, not a new engine") with three encoded-specific
 * defaults `frame-delay.ts`'s decoded backend doesn't need:
 *
 *  - `isKeyframe: (f) => f.type === "key"`: real classification, not the
 *    decoded backend's hardcoded `false` (irrelevant there: a decoded
 *    frame has no GOP dependency).
 *  - `frameBytes: (f) => f.data.byteLength`: real payload size, not the
 *    decoded backend's frame-count-as-1 cap.
 *  - `gopSafeEviction: true`, MANDATORY here (see
 *    `DelayedPlayoutBuffer.gopSafeEviction`'s doc): an encoded delta frame
 *    depends on a prior reference frame, so the decoded backend's
 *    drop-oldest-non-keyframe-one-at-a-time eviction would corrupt the
 *    decode chain.
 *
 * `close()` is never called on an encoded frame, `RTCEncodedVideoFrame`
 * holds no GPU/decoder resource (a plain data object), which is exactly why
 * `frame-delay.ts`'s `FrameLike.close` became optional.
 *
 * NOT wired into the camera Uplink's delayed-stream hook; see the encoded-video-delay
 * report's "what's blocked" section. Attaching `receiver.transform =
 * new RTCRtpScriptTransform(...)` needs the `RTCRtpReceiver` object, which
 * lives inside the camera SDK's browser transport
 * (the sibling `kerbcam` repo) and is discarded there today, `onTrack`
 * only forwards the bare `MediaStreamTrack`. This module is therefore
 * correct and tested, but reachable only once that SDK exposes a receiver
 * (or an equivalent attach hook): a cross-repo, versioned change out of
 * this task's scope. The worker-side glue (`worker/delay-worker.ts`'s
 * `self.onrtctransform` handler) that would consume this on the shared
 * worker is the next piece once that SDK seam exists.
 */

import type { DelayClockLike } from "./delayed-playout-buffer";
import {
  type FrameDelayPipeline,
  type FrameLike,
  type FrameSink,
  type FrameSource,
  runFrameDelayPipeline,
} from "./frame-delay";

/**
 * The parts of an `RTCEncodedVideoFrame` the delay reads. A real encoded frame
 * satisfies it as it is.
 *
 * @category Delayed video
 */
export interface EncodedVideoFrameLike extends FrameLike {
  /** `"key"` for a frame that can be decoded alone, `"delta"` for one that needs the frames before it. */
  readonly type: "key" | "delta";
  /** The encoded bytes. */
  readonly data: ArrayBuffer;
}

/**
 * The `transformer` of an `RTCTransformEvent`: a readable and a writable stream
 * of encoded frames.
 *
 * @category Delayed video
 */
export interface EncodedTransformerLike {
  /** The frames coming in. */
  readable: ReadableStream<EncodedVideoFrameLike>;
  /** Where the delayed frames are written. */
  writable: WritableStream<EncodedVideoFrameLike>;
}

/**
 * Options for `attachEncodedFrameDelayTransform`.
 *
 * @category Delayed video
 */
export interface EncodedFrameDelayOptions {
  /** THE delay clock: the same instance telemetry reads. */
  view: DelayClockLike;
  /**
   * Returns the UT to stamp a frame with, called once for each frame as it is
   * read, before it is decoded. {@link interpolateCaptureUt} computes one from
   * the capture clock.
   */
  captureUt(): number;
  /**
   * The most encoded video, in bytes, to hold before dropping the oldest.
   * Defaults to {@link DEFAULT_MAX_BUFFERED_BYTES}.
   */
  maxBufferedBytes?: number;
  /**
   * How far behind, in seconds, the pacer may fall before it skips straight to
   * the newest frame. See {@link PresentationPacerOptions}.
   */
  maxPacingBacklogSeconds?: number;
  /** Non-fatal pipeline errors (a read/write rejection), reported here,
   *  never thrown across the internal pump loop. */
  onError?(error: unknown): void;
}

/**
 * The most encoded video, in bytes, the delay holds before it drops the oldest
 * frames, a whole keyframe group at a time so decoding never breaks: 8 MiB.
 *
 * @category Delayed video
 */
export const DEFAULT_MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

/** Mirrors `frame-delay.ts`'s own default: see that constant's doc. */
const DEFAULT_PACING_MAX_BACKLOG_SECONDS = 0.5;

/**
 * Delays the encoded frames passing through `transformer`, the same way
 * {@link runFrameDelayPipeline} delays decoded ones.
 *
 * Call `pipeline.tickPacing(nowWall)` about 60 times a second while it runs;
 * {@link startPacingTicker} does that.
 *
 * @category Delayed video
 */
export function attachEncodedFrameDelayTransform(
  transformer: EncodedTransformerLike,
  opts: EncodedFrameDelayOptions,
): FrameDelayPipeline {
  const source =
    transformer.readable.getReader() as FrameSource<EncodedVideoFrameLike>;
  const sink =
    transformer.writable.getWriter() as FrameSink<EncodedVideoFrameLike>;

  return runFrameDelayPipeline<EncodedVideoFrameLike>({
    view: opts.view,
    captureUt: opts.captureUt,
    source,
    sink,
    maxBufferedFrames: opts.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES,
    isKeyframe: (f) => f.type === "key",
    frameBytes: (f) => f.data.byteLength,
    gopSafeEviction: true,
    onError: opts.onError,
    pacing: {
      maxBacklogSeconds:
        opts.maxPacingBacklogSeconds ?? DEFAULT_PACING_MAX_BACKLOG_SECONDS,
    },
  });
}
