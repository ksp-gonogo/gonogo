/**
 * Capability detection for the WebCodecs Opus path the push-to-talk radio
 * rides.
 *
 * The shape mirrors `isFrameDelaySupported()` next door: a synchronous feature
 * detect a caller runs before building anything, so an unsupported browser gets
 * a reported fact instead of a broken pipeline. **A presence check alone is
 * wrong in both directions.** `AudioEncoder`/`AudioDecoder` need a secure
 * context, and on a plain-http origin chromium and firefox leave both
 * constructors `undefined` while webkit exposes them and fails later, at
 * `getUserMedia`.
 *
 * `radioSupportStatus()` therefore asks about the context FIRST and names
 * an insecure origin as its own outcome, so a caller can say "this page is
 * not a secure origin" rather than the falsehood "your browser has no
 * codec". That distinction is operator-facing: the dev server binds the LAN
 * (`packages/app/vite.config.ts`, `server: { host: true }`), so a station
 * opened at `http://<lan-ip>:5173` lands in exactly this state every time.
 * Production over https, and `localhost` dev, are both secure and fine.
 *
 * `tests/playwright/radio-capability.spec.ts` is the cross-engine ratchet
 * over the same facts, including a live encode/decode round trip.
 */

/**
 * The WebCodecs constructors the radio needs: `AudioEncoder`, `AudioDecoder`,
 * `AudioData` and `EncodedAudioChunk`. {@link radioSupportStatus} checks for
 * them.
 *
 * @category Radio
 */
export const RADIO_REQUIRED_GLOBALS = [
  "AudioEncoder",
  "AudioDecoder",
  "AudioData",
  "EncodedAudioChunk",
] as const;

/**
 * The encoder configuration the radio transmits at: 20 ms chunks of mono
 * 48 kHz audio at a voice-radio bitrate.
 * `bitrate` is a target that some browsers exceed, so size buffers by the
 * measured rate rather than this number.
 *
 * @category Radio
 */
export const RADIO_ENCODER_CONFIG = {
  /** The codec, Opus. */
  codec: "opus",
  /** Samples per second, in hertz. */
  sampleRate: 48_000,
  /** One channel: mono. */
  numberOfChannels: 1,
  /** The target bitrate, in bits per second. */
  bitrate: 12_000,
} as const;

/** The decoder half of {@link RADIO_ENCODER_CONFIG}: no bitrate, since a
 *  decoder is told what the stream is rather than what to aim for.
 *
 * @category Radio
 */
export const RADIO_DECODER_CONFIG = {
  /** The codec, Opus. */
  codec: "opus",
  /** Samples per second, in hertz. */
  sampleRate: 48_000,
  /** One channel: mono. */
  numberOfChannels: 1,
} as const;

/** Samples per encoded chunk at {@link RADIO_ENCODER_CONFIG}'s sample
 *  rate: 20 ms, as Opus and the radio's wire frames both use.
 *
 * @category Radio
 */
export const RADIO_CHUNK_FRAMES = 960;

/** Why the radio cannot run here. `insecure-context` the operator can fix
 *  by opening the page over https or on localhost; `no-codec` they cannot.
 *
 * @category Radio
 */
export type RadioUnsupportedReason = "insecure-context" | "no-codec";

/**
 * Whether this browser can carry radio audio, and why not when it cannot.
 *
 * @category Radio
 */
export type RadioSupport =
  | { supported: true }
  | {
      supported: false;
      reason: RadioUnsupportedReason;
      /** The names from {@link RADIO_REQUIRED_GLOBALS} that were absent.
       *  Empty for `insecure-context`, which is diagnosed before the
       *  globals are consulted at all. */
      missing: readonly string[];
    };

/**
 * Returns whether this browser can run the radio, and why not when it
 * cannot. Use it rather than {@link isRadioSupported} wherever the result is
 * shown, so a page served over plain http says so.
 *
 * @category Radio
 */
export function radioSupportStatus(): RadioSupport {
  // `=== true` rather than a truthiness test: a host that is not a browser
  // (node, a test runner) does not define `isSecureContext` at all, and
  // anything other than the boolean a browser sets is a host we do not
  // recognise. Guessing in its favour is how a probe goes green somewhere
  // the microphone is refused.
  if (
    !("isSecureContext" in globalThis) ||
    globalThis.isSecureContext !== true
  ) {
    return { supported: false, reason: "insecure-context", missing: [] };
  }

  const missing = RADIO_REQUIRED_GLOBALS.filter(
    (name) => !(name in globalThis),
  );
  if (missing.length > 0) {
    return { supported: false, reason: "no-codec", missing };
  }
  return { supported: true };
}

/** Returns whether this page can run the radio: a secure page with every
 *  WebCodecs constructor it needs. {@link radioSupportStatus} also says why
 *  not.
 *
 * @category Radio
 * @categoryDescription Radio
 * Whether this browser can carry live push-to-talk radio, and the audio
 * settings the radio encodes and decodes with. The audio itself is sent with
 * the `commcast.radio.transmit` command and heard on the `commcast.radio`
 * Topic, as binary frames.
 */
export function isRadioSupported(): boolean {
  return radioSupportStatus().supported;
}
