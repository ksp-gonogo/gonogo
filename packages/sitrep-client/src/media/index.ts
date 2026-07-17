// Generic delayed-media infrastructure — media + time, riding the same
// `ViewClock` delay authority telemetry reads. Moved here from a camera
// Uplink client (2026-07-17) because none of it is mod-specific: a
// `DelayedPlayoutBuffer` consumes the clock STRUCTURALLY via `DelayClockLike`
// (zero imports), and every future camera Uplink needs the same buffer /
// per-frame pipeline / per-camera sharing. It stays decoupled from any camera
// SDK — the caller injects the clock, the raw `MediaStream`, and (for the
// shared cache) the build function.

export type { CaptureClockSample } from "./capture-clock";
export { interpolateCaptureUt } from "./capture-clock";
export type {
  DelayClockLike,
  DelayedPlayoutBufferOptions,
  StampedFrame,
} from "./delayed-playout-buffer";
export { DelayedPlayoutBuffer } from "./delayed-playout-buffer";
export type {
  EncodedFrameDelayOptions,
  EncodedTransformerLike,
  EncodedVideoFrameLike,
} from "./encoded-frame-delay";
export {
  attachEncodedFrameDelayTransform,
  DEFAULT_MAX_BUFFERED_BYTES,
} from "./encoded-frame-delay";
export type {
  CreateFrameDelayStreamOptions,
  FrameDelayPipeline,
  FrameDelayPipelineOptions,
  FrameDelayStream,
  FrameLike,
  FrameSink,
  FrameSource,
} from "./frame-delay";
export {
  createFrameDelayStream,
  isFrameDelaySupported,
  runFrameDelayPipeline,
  startPacingTicker,
} from "./frame-delay";
export type {
  BuiltDelayedStream,
  DelayedStreamBuild,
  DelayedStreamBuildContext,
  DelayedStreamLease,
} from "./shared-delayed-streams";
export { SharedDelayedStreams } from "./shared-delayed-streams";
export type {
  AttachEncodedFrameDelayOptions,
  CreateWorkerFrameDelayStreamOptions,
  EncodedFrameDelayHandle,
  SnapshottableDelayClock,
} from "./worker/delay-worker-client";
export {
  attachEncodedWorkerFrameDelay,
  createWorkerFrameDelayStream,
} from "./worker/delay-worker-client";
