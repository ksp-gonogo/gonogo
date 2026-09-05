import {
  RADIO_CHUNK_FRAMES,
  RADIO_DECODER_CONFIG,
  RADIO_ENCODER_CONFIG,
  radioSupportStatus,
} from "@ksp-gonogo/sitrep-sdk/media";
import { chunkAmplitude } from "./amplitude";
import { mixSample } from "./mix";
import type {
  RadioAudioSink,
  RadioDecoderLike,
  RadioReceiver,
} from "./RadioSession";
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
 * Playout: one queue PER TRANSMISSION, drained together and summed, silence
 * from whichever of them has run dry.
 *
 * A queue is what makes playback run at NATURAL rate whatever cadence the
 * releases arrive in, which is the property the delay pipeline needs at the
 * end of it: `PresentationPacer` spaces the releases and this absorbs whatever
 * spacing error is left, without ever playing faster to catch up.
 *
 * There are several of them because the band is shared and the delays are not.
 * A single queue plays what it is given in the order it was given, so two
 * people talking at once would come out one after the other at twice the wall
 * time, each drifting further behind the moment they spoke. Per-lane queues
 * advance independently: a lane with nothing in it contributes zero and stays
 * where it is, so a talker who pauses does not push everybody else back.
 *
 * The limiter is {@link mixSample}, embedded from its own source rather than
 * written out again here, because an audio thread cannot import a module and a
 * second copy of the arithmetic is a second copy to get wrong. It is bound to a
 * `const` so the name survives a build that renames the declaration.
 */
export const PLAYOUT_WORKLET = `
const mix = ${mixSample.toString()};
class RadioPlayoutProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.lanes = new Map();
    // The highest lane id that has finished. Lane ids are handed out in
    // increasing order and never reused, so one number is enough to tell a
    // lane that has not started yet from one that is over.
    this.retired = -1;
    this.port.onmessage = (event) => {
      const message = event.data;
      let lane = this.lanes.get(message.lane);
      if (lane === undefined) {
        if (message.samples === undefined) return;
        // Audio for a transmission that has already finished playing out.
        // Dropped rather than opening a fresh lane, so a late write cannot
        // resurrect somebody who has stopped talking.
        if (message.lane <= this.retired) return;
        lane = { queue: [], offset: 0, closed: false };
        this.lanes.set(message.lane, lane);
      }
      if (message.samples !== undefined) lane.queue.push(message.samples);
      if (message.close === true) lane.closed = true;
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    // Read once per quantum rather than per sample: 128 walks of the map to do
    // the same thing 128 times is the one avoidable cost on the audio thread.
    const lanes = [...this.lanes.values()];
    for (let i = 0; i < out.length; i++) {
      let sum = 0;
      for (let l = 0; l < lanes.length; l++) {
        const lane = lanes[l];
        const head = lane.queue[0];
        if (head === undefined) continue;
        sum += head[lane.offset++];
        if (lane.offset >= head.length) {
          lane.queue.shift();
          lane.offset = 0;
        }
      }
      out[i] = mix(sum);
    }
    for (const [id, lane] of this.lanes) {
      if (!lane.closed || lane.queue.length > 0) continue;
      this.lanes.delete(id);
      if (id > this.retired) this.retired = id;
    }
    return true;
  }
}
registerProcessor("radio-playout", RadioPlayoutProcessor);
`;

/**
 * How the microphone is opened, whichever one it is.
 *
 * Shared with the device picker so the input an operator auditions in the
 * settings is processed exactly as the one they transmit through: a picker that
 * opened a raw stream would let them choose on the strength of a level the
 * radio never sends.
 */
export const RADIO_CAPTURE_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

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
export const startWebAudioCapture: StartRadioCapture = async (
  onChunk,
  options,
) => {
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
      ...RADIO_CAPTURE_CONSTRAINTS,
      /*
       * `exact`, so a chosen headset that has been unplugged FAILS the keying
       * rather than quietly opening the laptop's own microphone. An operator
       * who picked a device wants that device, and a radio that silently
       * switched to the room would be broadcasting something they did not
       * mean to send.
       */
      ...(options?.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
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
 * Speakers, through an `AudioWorklet` ring: ONE output for this screen, with a
 * lane on it for every transmission.
 *
 * One `AudioContext` rather than one per talker, and that is not only thrift.
 * Two contexts run on two clocks, so two transmissions summed by the operating
 * system would drift apart over a long keying; and engines cap how many a page
 * may hold, so a busy band would eventually fail to open one at all. Summing
 * inside a single graph is exact and unbounded.
 *
 * The context is created on construction and RESUMED on every write, because a
 * browser starts one suspended until the page has seen a user gesture. A
 * listener who has not clicked anything hears nothing and is told nothing,
 * which is a genuine gap rather than a designed silence; the first interaction
 * with the page clears it.
 */
export class WebAudioRadioReceiver implements RadioReceiver {
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
  private nextLane = 0;
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

  openStream(): RadioDecoderLike {
    return new WebCodecsRadioDecoder(this.lane(this.nextLane++));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    void this.ctx.close().catch(() => {});
  }

  /**
   * One transmission's share of the sum.
   *
   * Ids increase and are never reused, which the worklet relies on: it keeps
   * only the highest it has finished, and refuses anything at or below it. A
   * write after a close cannot therefore land in somebody else's voice, nor
   * restart a transmission that has already played out.
   */
  private lane(id: number): RadioAudioSink {
    const post = (message: object, transfer: Transferable[]) => {
      if (this.closed) return;
      void this.ctx.resume().catch(() => {});
      void this.ready
        .then((node) => {
          // `null` when the sink was closed inside the two turns the worklet
          // takes to load, which is the case the settling `ready` exists for.
          if (this.closed || node === null) return;
          node.port.postMessage(message, transfer);
        })
        .catch(() => {});
    };
    let laneClosed = false;
    return {
      play: (samples: Float32Array) => {
        if (laneClosed) return;
        post({ lane: id, samples }, [samples.buffer]);
      },
      close: () => {
        if (laneClosed) return;
        laneClosed = true;
        post({ lane: id, close: true }, []);
      },
    };
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
