// Generic delayed-media infrastructure: media + time, riding the same
// `ViewClock` delay authority telemetry reads. None of it is mod-specific: a
// `DelayedPlayoutBuffer` consumes the clock STRUCTURALLY via `DelayClockLike`,
// and every camera Uplink needs the same buffer / per-frame pipeline /
// per-camera sharing. It stays decoupled from any camera SDK: the caller
// injects the clock, the raw `MediaStream`, and (for the shared cache) the
// build function.
//
// A SUBPATH (`@ksp-gonogo/sitrep-sdk/media`) rather than part of the root
// barrel, because it pulls WebCodecs/Worker machinery no telemetry-only Uplink
// wants. A consumer that never imports the subpath never loads any of it, which
// does not depend on tree-shaking to hold.

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
export type { RadioSupport, RadioUnsupportedReason } from "./radio-support";
export {
  isRadioSupported,
  RADIO_CHUNK_FRAMES,
  RADIO_DECODER_CONFIG,
  RADIO_ENCODER_CONFIG,
  RADIO_REQUIRED_GLOBALS,
  radioSupportStatus,
} from "./radio-support";
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
// The paced-release half of the delay pipeline, and a peer of the buffer above
// rather than a worker detail. A `DelayedPlayoutBuffer` releases a BURST when
// the confirmed edge steps (it steps at telemetry sample cadence, not at media
// cadence), so anything presenting what it releases wants this in between. It
// was reachable only from inside the worker backend until the push-to-talk
// radio needed the same re-timing on the main thread; the file imports nothing
// and pulls no worker globals along with it.
export type {
  PacedFrame,
  PresentationPacerOptions,
} from "./worker/presentation-pacer";
export { PresentationPacer } from "./worker/presentation-pacer";
