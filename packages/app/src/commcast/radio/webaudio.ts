import {
  RADIO_CHUNK_FRAMES,
  RADIO_DECODER_CONFIG,
  RADIO_ENCODER_CONFIG,
  radioSupportStatus,
} from "@ksp-gonogo/sitrep-sdk/media";
import { chunkAmplitude } from "./amplitude";
import type { RadioAudioSink, RadioDecoderLike } from "./RadioSession";
import type { RadioCapture, StartRadioCapture } from "./RadioTransmitter";

/**
 * The browser half of the radio: microphone in, speakers out, and nothing else.
 *
 * Deliberately the thinnest file in the folder. Every decision worth testing
 * (when a chunk may be played, what a cut does, what the operator is told) lives
 * behind `RadioSession` and `RadioTransmitter`, which are handed these as
 * injected seams. What is left here is graph construction against WebCodecs and
 * Web Audio, which is exercised in a browser by
 * `tests/playwright/radio-capability.spec.ts` and cannot be meaningfully
 * exercised in jsdom.
 *
 * The two worklet processors are built from source strings and loaded as blob
 * URLs rather than shipped as build assets. An `AudioWorklet` module has to be
 * a separately-addressable script, and a blob keeps that fact out of the Vite
 * config, out of the Uplink bundler, and out of every consumer's build.
 */

/**
 * Capture: 128-sample render quanta accumulated into the 20 ms frames the
 * encoder wants. The accumulation happens on the audio thread because that is
 * where the samples already are; posting each quantum to the main thread would
 * be 375 messages a second to do the same arithmetic.
 */
const CAPTURE_WORKLET = `
class RadioCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frames = options.processorOptions.frames;
    this.buf = new Float32Array(this.frames);
    this.at = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.buf[this.at++] = channel[i];
      if (this.at === this.frames) {
        const full = this.buf;
        this.port.postMessage(full, [full.buffer]);
        this.buf = new Float32Array(this.frames);
        this.at = 0;
      }
    }
    return true;
  }
}
registerProcessor("radio-capture", RadioCaptureProcessor);
`;

/**
 * Playout: a queue of decoded blocks drained one sample at a time, silence when
 * it runs dry.
 *
 * The queue is what makes playback run at NATURAL rate whatever cadence the
 * releases arrive in, which is the property the delay pipeline needs at the
 * end of it: `PresentationPacer` spaces the releases and this absorbs whatever
 * spacing error is left, without ever playing faster to catch up.
 */
const PLAYOUT_WORKLET = `
class RadioPlayoutProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.port.onmessage = (event) => { this.queue.push(event.data); };
  }
  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    for (let i = 0; i < out.length; i++) {
      const head = this.queue[0];
      if (head === undefined) {
        out[i] = 0;
        continue;
      }
      out[i] = head[this.offset++];
      if (this.offset >= head.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("radio-playout", RadioPlayoutProcessor);
`;

function moduleUrl(source: string): string {
  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

async function addWorklet(ctx: AudioContext, source: string): Promise<void> {
  const url = moduleUrl(source);
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Open the microphone, encode it as Opus, and hand back one chunk per 20 ms.
 *
 * Throws before touching a device when the page cannot run the pipeline at all,
 * so the caller states a fact rather than watching a permission prompt for a
 * codec that is not there. The two reasons are genuinely different to an
 * operator: an insecure origin is something they can act on (reach the page over
 * https or through localhost), a missing codec is not.
 */
export const startWebAudioCapture: StartRadioCapture = async (onChunk) => {
  const support = radioSupportStatus();
  if (!support.supported) {
    throw new Error(
      support.reason === "insecure-context"
        ? "Not a secure origin"
        : "No audio codec",
    );
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const ctx = new AudioContext({ sampleRate: RADIO_ENCODER_CONFIG.sampleRate });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const track of stream.getTracks()) track.stop();
    void ctx.close();
  };

  /*
   * One amplitude per chunk in, read off the SAME buffer the encoder is handed
   * and drained as its output comes back. Opus at a fixed frame size is one
   * encoded chunk per input frame, in order, so the queue pairs a chunk with
   * its own loudness rather than a neighbour's.
   *
   * Capped, because an encoder that stops emitting (the `error` path below
   * ends the transmission, but not before some frames are in it) must not grow
   * this without bound; and drained with a fallback, so a chunk arriving with
   * nothing queued repeats the last reading rather than reporting silence that
   * was never measured.
   */
  const pendingAmplitudes: number[] = [];
  const MAX_PENDING = 50;
  let lastAmplitude = 0;

  try {
    await addWorklet(ctx, CAPTURE_WORKLET);
    const encoder = new AudioEncoder({
      output: (chunk) => {
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        lastAmplitude = pendingAmplitudes.shift() ?? lastAmplitude;
        onChunk(bytes, lastAmplitude);
      },
      /*
       * A failed encode ends the transmission rather than being swallowed: an
       * operator talking into a dead encoder is the one state this must not
       * present as normal.
       */
      error: () => stop(),
    });
    encoder.configure(RADIO_ENCODER_CONFIG);

    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "radio-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { frames: RADIO_CHUNK_FRAMES },
    });
    let timestamp = 0;
    node.port.onmessage = (event: MessageEvent<Float32Array<ArrayBuffer>>) => {
      if (stopped || encoder.state !== "configured") return;
      // Before the encode, because `AudioData` takes the buffer from here on
      // and this is the one moment the raw PCM is ours to read.
      if (pendingAmplitudes.length >= MAX_PENDING) pendingAmplitudes.shift();
      pendingAmplitudes.push(chunkAmplitude(event.data));
      const data = new AudioData({
        format: "f32-planar",
        sampleRate: RADIO_ENCODER_CONFIG.sampleRate,
        numberOfFrames: RADIO_CHUNK_FRAMES,
        numberOfChannels: 1,
        timestamp,
        data: event.data,
      });
      timestamp += Math.round(
        (RADIO_CHUNK_FRAMES / RADIO_ENCODER_CONFIG.sampleRate) * 1e6,
      );
      encoder.encode(data);
      data.close();
    };
    source.connect(node);

    const capture: RadioCapture = {
      stop: () => {
        node.port.onmessage = null;
        source.disconnect();
        if (encoder.state === "configured") encoder.close();
        stop();
      },
    };
    return capture;
  } catch (err) {
    stop();
    throw err;
  }
};

/**
 * Speakers, through an `AudioWorklet` ring.
 *
 * The context is created on construction and RESUMED on every write, because a
 * browser starts one suspended until the page has seen a user gesture. A
 * listener who has not clicked anything hears nothing and is told nothing,
 * which is a genuine gap rather than a designed silence; the first interaction
 * with the page clears it.
 */
export class WebAudioRadioSink implements RadioAudioSink {
  private readonly ctx: AudioContext;
  /**
   * The playout node, or `null` where there will not be one.
   *
   * It SETTLES rather than rejects, and that is the whole of why it is written
   * this way. Building the node is two turns behind the constructor (the
   * worklet module has to load first), and a sink closed inside that window
   * constructs an `AudioWorkletNode` against a closed context, which throws.
   * Attaching the only `catch` inside `play` left that rejection unhandled for
   * exactly the sink that never played: a listener who muted, changed
   * conversation or closed the tab before anybody spoke got an uncaught error
   * in the console and in Axiom, for a teardown that went entirely to plan.
   * Seen every run of the three-screen radio scene, on the one screen that
   * hears nothing.
   */
  private readonly ready: Promise<AudioWorkletNode | null>;
  private closed = false;

  constructor(sampleRate: number = RADIO_DECODER_CONFIG.sampleRate) {
    this.ctx = new AudioContext({ sampleRate });
    this.ready = addWorklet(this.ctx, PLAYOUT_WORKLET)
      .then(() => {
        if (this.closed) return null;
        const node = new AudioWorkletNode(this.ctx, "radio-playout", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        node.connect(this.ctx.destination);
        return node;
      })
      .catch(() => null);
  }

  play(samples: Float32Array): void {
    if (this.closed) return;
    void this.ctx.resume().catch(() => {});
    void this.ready.then((node) => {
      if (this.closed || node === null) return;
      node.port.postMessage(samples, [samples.buffer]);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    void this.ctx.close().catch(() => {});
  }
}

/** WebCodecs Opus decode, writing straight into a sink. */
export class WebCodecsRadioDecoder implements RadioDecoderLike {
  private decoder: AudioDecoder | null = null;
  private closed = false;

  constructor(private readonly sink: RadioAudioSink) {}

  decode(bytes: Uint8Array, timestampMicros: number): void {
    if (this.closed) return;
    const decoder = this.decoder ?? this.build();
    if (decoder.state !== "configured") return;
    decoder.decode(
      new EncodedAudioChunk({
        /*
         * Every encoded Opus chunk is a key frame: there is no GOP and no
         * inter-frame dependency, which is also why the buffer above evicts
         * one chunk at a time rather than a whole run.
         */
        type: "key",
        timestamp: timestampMicros,
        data: bytes,
      }),
    );
  }

  reset(): void {
    this.decoder?.close();
    this.decoder = null;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.decoder?.close();
    this.decoder = null;
    this.sink.close();
  }

  private build(): AudioDecoder {
    const decoder = new AudioDecoder({
      output: (data) => {
        const samples = new Float32Array(data.numberOfFrames);
        const rate = data.sampleRate;
        data.copyTo(samples, { planeIndex: 0, format: "f32-planar" });
        data.close();
        this.sink.play(samples, rate);
      },
      error: () => this.reset(),
    });
    decoder.configure(RADIO_DECODER_CONFIG);
    this.decoder = decoder;
    return decoder;
  }
}
