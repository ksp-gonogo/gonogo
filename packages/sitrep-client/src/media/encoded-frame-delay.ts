/**
 * The encoded-domain per-frame video delay backend (encoded-transform
 * cross-browser video-delay work, 2026-07-16 — see
 * `local_docs/reports/encoded-transform-spike-report.md` for the spike and
 * `local_docs/reports/encoded-video-delay-report.md` for the Phase-1
 * capture-UT mapping validation this backend implements).
 *
 * UNLIKE `frame-delay.ts`'s decoded backend (`MediaStreamTrackProcessor` /
 * `MediaStreamTrackGenerator` — Chromium-only on the main thread), this
 * backend attaches to the standard, cross-browser
 * `RTCRtpScriptTransform`/`RTCTransformEvent.transformer` shape: a
 * `{readable, writable}` pair of ENCODED `RTCEncodedVideoFrame`s, delivered
 * pre-decode. Empirically confirmed to hold a real multi-second delay with
 * zero drops on Chromium, Firefox, and WebKit (spike report), gated on a
 * REAL `confirmedEdgeUt()` computation rather than arrival+fixedDelayMs
 * (Phase-1 report) — this module is the production wiring of that proof.
 *
 * `attachEncodedFrameDelayTransform` is a thin adapter: it reuses
 * `runFrameDelayPipeline` VERBATIM (F1 from the design doc — "a new backend
 * is a new source/sink pair, not a new engine") with three encoded-specific
 * defaults `frame-delay.ts`'s decoded backend doesn't need:
 *
 *  - `isKeyframe: (f) => f.type === "key"` — real classification, not the
 *    decoded backend's hardcoded `false` (irrelevant there — a decoded
 *    frame has no GOP dependency).
 *  - `frameBytes: (f) => f.data.byteLength` — real payload size, not the
 *    decoded backend's frame-count-as-1 cap.
 *  - `gopSafeEviction: true` — MANDATORY here (see
 *    `DelayedPlayoutBuffer.gopSafeEviction`'s doc): an encoded delta frame
 *    depends on a prior reference frame, so the decoded backend's
 *    drop-oldest-non-keyframe-one-at-a-time eviction would corrupt the
 *    decode chain.
 *
 * `close()` is never called on an encoded frame — `RTCEncodedVideoFrame`
 * holds no GPU/decoder resource (a plain data object), which is exactly why
 * `frame-delay.ts`'s `FrameLike.close` became optional.
 *
 * NOT wired into the camera Uplink's delayed-stream hook — see the encoded-video-delay
 * report's "what's blocked" section. Attaching `receiver.transform =
 * new RTCRtpScriptTransform(...)` needs the `RTCRtpReceiver` object, which
 * lives inside the camera SDK's browser transport
 * (the sibling `kerbcam` repo) and is discarded there today — `onTrack`
 * only forwards the bare `MediaStreamTrack`. This module is therefore
 * correct and tested, but reachable only once that SDK exposes a receiver
 * (or an equivalent attach hook) — a cross-repo, versioned change out of
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

/** The minimal shape of a real `RTCEncodedVideoFrame` this module depends
 *  on — narrowed to what the pipeline actually reads. A real
 *  `RTCEncodedVideoFrame` satisfies this directly (no adapter needed,
 *  including the inherited optional `close` — a real encoded frame simply
 *  never defines one), matching `frame-delay.ts`'s own "tests pass a fake"
 *  convention. Extends `FrameLike` explicitly (rather than relying on
 *  structural assignability) because TypeScript's weak-type check rejects
 *  an object type with literally zero overlapping property names, even
 *  when the only declared member is optional. */
export interface EncodedVideoFrameLike extends FrameLike {
  readonly type: "key" | "delta";
  readonly data: ArrayBuffer;
}

/** The minimal shape of a real `RTCRtpScriptTransform`'s
 *  `RTCTransformEvent.transformer` — a `{readable, writable}` pair of
 *  encoded frames. Matches what `self.onrtctransform`'s `event.transformer`
 *  provides directly. */
export interface EncodedTransformerLike {
  readable: ReadableStream<EncodedVideoFrameLike>;
  writable: WritableStream<EncodedVideoFrameLike>;
}

export interface EncodedFrameDelayOptions {
  /** THE delay clock — the same instance telemetry reads. */
  view: DelayClockLike;
  /** Capture-UT to stamp EACH incoming frame with — called once per frame
   *  read off the transformer's `readable`, at read time (Phase-1 approach
   *  1: wall-clock interpolation of an out-of-band capture-clock sample,
   *  evaluated pre-decode — see the encoded-video-delay report). */
  captureUt(): number;
  /** Real byte cap (NOT a frame count — contrast `frame-delay.ts`'s
   *  `maxBufferedFrames`). Defaults to `DEFAULT_MAX_BUFFERED_BYTES`, sized
   *  generously above the spike report's ~0.75-2MB production estimate for
   *  a 4s buffer at the stream's pinned bitrate — eviction should be
   *  rare-to-never in practice (encoded buffers are 50-360x smaller than
   *  the decoded backend's). */
  maxBufferedBytes?: number;
  /** Override the presentation pacer's backlog threshold — see
   *  `frame-delay.ts`'s `DEFAULT_PACING_MAX_BACKLOG_SECONDS`. */
  maxPacingBacklogSeconds?: number;
  /** Non-fatal pipeline errors (a read/write rejection) — reported here,
   *  never thrown across the internal pump loop. */
  onError?(error: unknown): void;
}

/** ~4x the spike report's ~2MB unpinned-bitrate production estimate for a
 *  4-second buffer — generous headroom without inviting unbounded growth. */
export const DEFAULT_MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

/** Mirrors `frame-delay.ts`'s own default — see that constant's doc. */
const DEFAULT_PACING_MAX_BACKLOG_SECONDS = 0.5;

/**
 * Attach the encoded-domain delay pipeline to an already-obtained
 * `RTCRtpScriptTransform` transformer (or an equivalent fake in tests).
 * Reuses `runFrameDelayPipeline` verbatim — same buffer, same clock seam,
 * same "can't build -> caller decides fallback" contract as
 * `createFrameDelayStream`, just with the encoded-specific classification
 * described in this module's doc.
 *
 * The caller (worker-side glue, once wired) is responsible for driving
 * `pipeline.tickPacing(nowWall)` on a ~60Hz loop — see
 * `frame-delay.ts`'s `startPacingTicker`, reused as-is.
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
