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
