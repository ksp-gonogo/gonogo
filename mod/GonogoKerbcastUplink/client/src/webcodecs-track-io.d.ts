/**
 * Ambient declarations for the MediaStreamTrack Insertable Media Processing
 * using Streams (a.k.a. "Breakout Box") APIs — `MediaStreamTrackProcessor` /
 * `MediaStreamTrackGenerator` (Chrome's original shape) and
 * `VideoTrackGenerator` (the standardised shape landing in Firefox/Safari —
 * see the mediacapture-transform "unbundling" spec change). None of these
 * are yet part of TypeScript's bundled `lib.dom.d.ts` (checked against the
 * TS version pinned in this repo — `VideoFrame` itself IS in lib.dom, none
 * of the track-IO constructors are).
 *
 * Used by `frameDelay.ts` (Chrome's main-thread backend) and `worker/`
 * (the worker-hosted backend feature-detects `VideoTrackGenerator` first,
 * falling back to `MediaStreamTrackGenerator` — cross-browser kerbcast
 * video-delay design, 2026-07-16, "Writer feature detection") to read/write
 * real video frames off/onto a `MediaStreamTrack`. Kept minimal — only the
 * members either backend actually touches.
 *
 * https://w3c.github.io/mediacapture-transform/
 */

interface MediaStreamTrackProcessorInit {
  track: MediaStreamTrack;
  maxBufferSize?: number;
}

interface MediaStreamTrackProcessor {
  readonly readable: ReadableStream<VideoFrame>;
}

declare var MediaStreamTrackProcessor: {
  prototype: MediaStreamTrackProcessor;
  new (init: MediaStreamTrackProcessorInit): MediaStreamTrackProcessor;
};

interface MediaStreamTrackGeneratorInit {
  kind: "video" | "audio";
}

interface MediaStreamTrackGenerator extends MediaStreamTrack {
  readonly writable: WritableStream<VideoFrame>;
}

declare var MediaStreamTrackGenerator: {
  prototype: MediaStreamTrackGenerator;
  new (init: MediaStreamTrackGeneratorInit): MediaStreamTrackGenerator;
};

/**
 * The standardised writer — unlike Chrome's `MediaStreamTrackGenerator`
 * (which itself IS a `MediaStreamTrack`), `VideoTrackGenerator` HAS one via
 * `.track`. Video-only (no `kind` init — contrast `MediaStreamTrackGenerator`,
 * which is generic audio/video). Confirmed present, worker-context-only, in
 * WebKit 26.4 (2026-07-16 empirical verification — see
 * `local_docs/reports/video-worker-report.md`).
 */
interface VideoTrackGenerator {
  readonly writable: WritableStream<VideoFrame>;
  readonly track: MediaStreamTrack;
}

declare var VideoTrackGenerator: {
  prototype: VideoTrackGenerator;
  new (): VideoTrackGenerator;
};

/**
 * The standard WebRTC Encoded Transform API — `RTCRtpScriptTransform`,
 * assigned to `RTCRtpReceiver.transform` (or `RTCRtpSender.transform`) to
 * attach a worker-hosted transform to that receiver/sender's encoded frame
 * stream. Confirmed present via `typeof RTCRtpScriptTransform !==
 * "undefined"` on Chromium/Firefox/WebKit — see
 * `local_docs/reports/encoded-video-delay-report.md`. Not yet in this
 * repo's pinned TS DOM lib (checked against the TS version pinned in this
 * repo), so declared here for the same "ambient, minimal surface" reason
 * as the rest of this file. `RTCRtpReceiver` itself IS already in
 * `lib.dom.d.ts` — this only adds the `transform` member that lib is
 * missing, via interface merging.
 *
 * https://w3c.github.io/webrtc-encoded-transform/
 */
type RTCRtpScriptTransform = {};

declare var RTCRtpScriptTransform: {
  prototype: RTCRtpScriptTransform;
  new (worker: Worker, options?: unknown): RTCRtpScriptTransform;
};

interface RTCRtpReceiver {
  transform: RTCRtpScriptTransform | null;
}
