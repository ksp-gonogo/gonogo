/**
 * Recorded audio the radio can be driven with, with no microphone and no codec.
 *
 * `webaudio.ts` is the only file in this folder that touches `getUserMedia`,
 * `AudioEncoder` or `AudioDecoder`, and everything worth exercising sits behind
 * it: chunking, the envelope, the separation frozen per transmission, the
 * delayed release, the backlog, and what a cut does. A clip standing in for the
 * microphone and a recording sink standing in for the speakers therefore reach
 * all of it, in jsdom and in a render harness alike.
 *
 * **The clips are deterministic, and that is the point rather than a
 * convenience.** A render has to photograph the same audio every run or the
 * picture is not reproducible, and a roundtrip assertion is only worth making
 * if what came out can be compared to something exactly. So a clip is a list of
 * 20 ms tones with integer frequencies and byte-quantised amplitudes: nothing
 * is sampled from a device, nothing is seeded from a clock, and the samples the
 * decoder regenerates are bit-for-bit the ones the clip describes.
 *
 * **The fake codec is PARAMETRIC, not raw PCM, and that is load-bearing.** Raw
 * int16 at this grid is 1920 bytes per chunk, 96 kB/s, which would trip
 * `RADIO_BYTES_BUDGET` (40 kB/s) inside the first second and fail every test
 * that spoke for a second. Six bytes a chunk puts the harness at 300 B/s, an
 * order of magnitude UNDER the 4.3 kB/s the slice-0 probe measured for real
 * Opus, so a budget breach in a test is always about the code and never about
 * the stand-in.
 */
import {
  RADIO_CHUNK_FRAMES,
  RADIO_ENCODER_CONFIG,
} from "@ksp-gonogo/sitrep-sdk/media";
import type { RadioBackend } from "./backend";
import type { RadioAudioSink, RadioDecoderLike } from "./RadioSession";
import type { RadioCapture, StartRadioCapture } from "./RadioTransmitter";

/** Seconds of audio one chunk carries: the 20 ms grid the real encoder uses. */
export const CLIP_CHUNK_SECONDS =
  RADIO_CHUNK_FRAMES / RADIO_ENCODER_CONFIG.sampleRate;

/**
 * Bytes one encoded chunk occupies on the wire.
 *
 * Chosen to sit in the same order of magnitude as the real thing rather than to
 * be as small as possible: the slice-0 probe measured 61 to 85 bytes per Opus
 * chunk across the three engines, so a stand-in of six is comfortably below
 * every budget without pretending the wire is free.
 */
export const CLIP_CHUNK_BYTES = 6;

/** Leading byte of every clip chunk, so a decoder handed somebody else's bytes
 *  says so instead of rendering silence that looks like a design decision. */
const CLIP_MAGIC = 0xa7;

/** One 20 ms slice of a clip: a tone, at an amplitude, on the encoder's grid. */
export interface ClipChunk {
  /** Integer hertz, so the encode and the decode cannot round differently. */
  frequencyHz: number;
  /** 0 to 255. Quantised at construction, for the same reason. */
  amplitudeByte: number;
}

/** A fixed utterance: what one keying of the microphone says, every time. */
export interface RadioClip {
  readonly name: string;
  readonly chunks: readonly ClipChunk[];
  /** Wall seconds the clip lasts, at the encoder's grid. */
  readonly seconds: number;
}

/**
 * A clip of `chunkCount` slices, shaped by nothing but its own index.
 *
 * The frequency walks a nine-step cycle from `baseHz` and the amplitude rides a
 * raised-cosine envelope, so the waveform has a beginning, a middle and an end
 * the way an utterance does, and two calls with the same arguments produce the
 * same bytes on any machine in any year.
 *
 * `baseHz` is what makes two clips tell apart in a recorded sink: a test
 * asserting which of two transmissions was heard has to compare the samples,
 * and two clips built on one pitch would be the same audio under two names.
 */
export function makeClip(
  name: string,
  chunkCount: number,
  baseHz = 180,
): RadioClip {
  const chunks: ClipChunk[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const phase = chunkCount === 1 ? 1 : i / (chunkCount - 1);
    chunks.push({
      frequencyHz: baseHz + 40 * ((i * 7) % 9),
      amplitudeByte: Math.round(
        255 * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase)),
      ),
    });
  }
  return { name, chunks, seconds: chunkCount * CLIP_CHUNK_SECONDS };
}

/**
 * Half a second of somebody talking: the ordinary keying every scene is built
 * on, and short enough that a whole transmission fits inside one perf window.
 */
export const SHORT_CLIP = makeClip("go for the burn", 25);

/** The reply, at its own pitch, so a sink holding both says which is which. */
export const REPLY_CLIP = makeClip("copy, starting the sequence", 25, 600);

/** A second of it, for the cases that need a release edge to outrun playback. */
export const LONG_CLIP = makeClip("say again your status", 50);

/** One chunk of `clip`, as it would come off the encoder. */
export function clipBytes(clip: RadioClip, index: number): Uint8Array {
  const chunk = clip.chunks[index];
  if (chunk === undefined) {
    throw new Error(
      `clip "${clip.name}" has ${clip.chunks.length} chunks; asked for ${index}`,
    );
  }
  const bytes = new Uint8Array(CLIP_CHUNK_BYTES);
  const view = new DataView(bytes.buffer);
  bytes[0] = CLIP_MAGIC;
  bytes[1] = chunk.amplitudeByte;
  view.setUint16(2, chunk.frequencyHz, true);
  view.setUint16(4, index, true);
  return bytes;
}

/** What one chunk's bytes say, read back off the wire. */
export function readClipChunk(
  bytes: Uint8Array,
): ClipChunk & { index: number } {
  if (bytes.byteLength !== CLIP_CHUNK_BYTES || bytes[0] !== CLIP_MAGIC) {
    throw new Error(
      "radio clips: these are not clip bytes. A decoder handed a foreign " +
        "chunk would otherwise write silence, which reads on screen and in a " +
        "test exactly like audio that was correctly delivered and empty.",
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    amplitudeByte: bytes[1],
    frequencyHz: view.getUint16(2, true),
    index: view.getUint16(4, true),
  };
}

/**
 * The 960 samples one chunk carries.
 *
 * Phase is counted off the chunk's INDEX rather than restarted per chunk, so a
 * clip played whole is one continuous tone rather than a stack of clicks, and a
 * clip missing its third chunk is audibly missing it.
 */
export function clipSamples(
  chunk: ClipChunk & { index: number },
): Float32Array {
  const samples = new Float32Array(RADIO_CHUNK_FRAMES);
  const amplitude = chunk.amplitudeByte / 255;
  const start = chunk.index * RADIO_CHUNK_FRAMES;
  for (let i = 0; i < RADIO_CHUNK_FRAMES; i++) {
    const t = (start + i) / RADIO_ENCODER_CONFIG.sampleRate;
    samples[i] = amplitude * Math.sin(2 * Math.PI * chunk.frequencyHz * t);
  }
  return samples;
}

/** Every sample of `clip`, in order: what a listener who heard all of it got. */
export function clipPcm(clip: RadioClip): Float32Array {
  const whole = new Float32Array(clip.chunks.length * RADIO_CHUNK_FRAMES);
  for (let i = 0; i < clip.chunks.length; i++) {
    whole.set(
      clipSamples({ ...clip.chunks[i], index: i }),
      i * RADIO_CHUNK_FRAMES,
    );
  }
  return whole;
}

/** A microphone playing a clip, opened and driven by whoever holds it. */
export interface ClipMic {
  /** Hand this to the radio wherever the real capture would go. */
  readonly start: StartRadioCapture;
  /** Emit the next chunk. `false` once the clip has run out. */
  speak(): boolean;
  /** Emit every chunk the clip has left. */
  speakAll(): void;
  /** Chunks emitted so far. */
  readonly spoken: number;
  /** Times the microphone was opened, and times it was stopped. */
  readonly openings: number;
  readonly stops: number;
}

/**
 * A microphone that plays `clip` instead of listening to a room.
 *
 * It opens immediately and speaks only when told, so a caller decides the
 * cadence: a test steps chunk by chunk against a hand-driven clock, and a
 * render harness plays the lot in one go and photographs the result. Neither
 * waits on a timer, which is what keeps both of them deterministic.
 */
export function clipMic(clip: RadioClip): ClipMic {
  let emit: ((bytes: Uint8Array) => void) | null = null;
  let spoken = 0;
  let openings = 0;
  let stops = 0;
  const capture: RadioCapture = {
    stop: () => {
      stops += 1;
      emit = null;
    },
  };
  return {
    start: (onChunk) => {
      openings += 1;
      emit = onChunk;
      return Promise.resolve(capture);
    },
    speak() {
      if (emit === null || spoken >= clip.chunks.length) return false;
      emit(clipBytes(clip, spoken));
      spoken += 1;
      return true;
    },
    speakAll() {
      while (this.speak()) {
        // Every chunk, in one go.
      }
    },
    get spoken() {
      return spoken;
    },
    get openings() {
      return openings;
    },
    get stops() {
      return stops;
    },
  };
}

/** One block of audio a sink was asked to play. */
export interface PlayedBlock {
  samples: Float32Array;
  sampleRate: number;
}

/**
 * Speakers that keep what they were given.
 *
 * Where `WebAudioRadioSink` writes into an `AudioWorklet` ring, this writes
 * into an array, so what a listener HEARD is a value a test can compare against
 * what was said.
 */
export class RecordingRadioSink implements RadioAudioSink {
  readonly played: PlayedBlock[] = [];
  closed = false;

  play(samples: Float32Array, sampleRate: number): void {
    if (this.closed) return;
    this.played.push({ samples, sampleRate });
  }

  close(): void {
    this.closed = true;
  }

  /** Seconds of audio played, at the rate each block arrived at. */
  get seconds(): number {
    return this.played.reduce(
      (total, block) => total + block.samples.length / block.sampleRate,
      0,
    );
  }

  /** Everything played, end to end, for comparing against `clipPcm`. */
  pcm(): Float32Array {
    const whole = new Float32Array(
      this.played.reduce((n, block) => n + block.samples.length, 0),
    );
    let at = 0;
    for (const block of this.played) {
      whole.set(block.samples, at);
      at += block.samples.length;
    }
    return whole;
  }
}

/**
 * The decode step for clip bytes, writing into whatever sink it is given.
 *
 * It regenerates the samples from the chunk's own parameters, so the audio a
 * listener gets is EXACTLY the audio the clip describes: a roundtrip can be
 * asserted sample for sample rather than approximately, which no real codec
 * would allow and which is the whole reason the stand-in is parametric.
 */
export class ClipDecoder implements RadioDecoderLike {
  /** Streams started: one per transmission, the property the session owes. */
  resets = 0;
  /** Every chunk decoded, with the presentation timestamp it arrived under. */
  readonly decoded: Array<{ index: number; timestampMicros: number }> = [];
  private closed = false;

  constructor(readonly sink: RecordingRadioSink) {}

  decode(bytes: Uint8Array, timestampMicros: number): void {
    if (this.closed) return;
    const chunk = readClipChunk(bytes);
    this.decoded.push({ index: chunk.index, timestampMicros });
    this.sink.play(clipSamples(chunk), RADIO_ENCODER_CONFIG.sampleRate);
  }

  reset(): void {
    this.resets += 1;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.sink.close();
  }
}

/** A whole radio driven by a clip: what to hand `RadioBackendProvider`, and the
 *  handles to drive and read it. */
export interface ClipRadio {
  readonly backend: RadioBackend;
  readonly mic: ClipMic;
  /** Every listening chain built under this backend, newest last. A mount that
   *  rebuilds its session builds another, so the count is itself a reading. */
  readonly decoders: ClipDecoder[];
}

/**
 * A radio wired end to end onto `clip`, with no browser anywhere in it.
 *
 * This is what a render harness mounts the widget with: the key latches, the
 * envelope goes on the wire, chunks follow it, and the far end plays into an
 * array. What is photographed is the real control in its real states, driven by
 * the real transmitter, over audio that is identical on every run.
 */
export function clipRadio(clip: RadioClip): ClipRadio {
  const mic = clipMic(clip);
  const decoders: ClipDecoder[] = [];
  return {
    mic,
    decoders,
    backend: {
      startCapture: mic.start,
      createDecoder: () => {
        const decoder = new ClipDecoder(new RecordingRadioSink());
        decoders.push(decoder);
        return decoder;
      },
    },
  };
}
