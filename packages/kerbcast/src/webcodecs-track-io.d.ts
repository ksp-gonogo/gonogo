/**
 * Ambient declarations for the MediaStreamTrack Insertable Media Processing
 * using Streams (a.k.a. "Breakout Box") APIs — `MediaStreamTrackProcessor` /
 * `MediaStreamTrackGenerator`. Chromium-only, not yet part of TypeScript's
 * bundled `lib.dom.d.ts` (checked against the TS version pinned in this repo
 * — `VideoFrame` itself IS in lib.dom, these two are not).
 *
 * Used by `frameDelay.ts` to read/write real video frames off/onto a
 * `MediaStreamTrack` for the per-frame delay pipeline (kerbcast per-frame
 * video delay, 2026-07-15). Kept minimal — only the members that pipeline
 * actually touches.
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
