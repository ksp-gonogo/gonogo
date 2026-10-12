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
 * `radioSupportStatus()` therefore asks about the context first and names
 * an insecure origin as its own outcome, so a caller can say "this page is
 * not a secure origin" rather than the falsehood "your browser has no
 * codec". That distinction is operator-facing: a station opened at
 * `http://<lan-ip>:5173` lands in exactly this state, while https and
 * `localhost` are both secure and fine.
 */

/**
 * The [WebCodecs](https://developer.mozilla.org/docs/Web/API/WebCodecs_API)
 * constructors the radio needs: `AudioEncoder`, `AudioDecoder`, `AudioData` and
 * `EncodedAudioChunk`. {@link radioSupportStatus} checks for them. Useful for
 * knowing whether this browser can carry the operator's push-to-talk radio.
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
 * 48 kHz audio at a voice-radio bitrate. Useful for encoding the operator's
 * microphone audio before it is sent. Used by the app's radio audio code.
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

/**
 * The decoder half of {@link RADIO_ENCODER_CONFIG}, without a bitrate. Useful
 * for decoding received radio audio so the operator can hear it. Used by the
 * app's radio audio code.
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

/**
 * Samples per encoded chunk at {@link RADIO_ENCODER_CONFIG}'s sample rate: 960,
 * which is 20 ms. Every Opus packet the radio sends and receives holds this many
 * samples. Useful for cutting microphone audio into chunks. Used by the app's
 * radio audio code.
 *
 * @category Radio
 */
export const RADIO_CHUNK_FRAMES = 960;

/**
 * Why the radio cannot run here. `insecure-context` the operator can fix by
 * opening the page over https or on localhost; `no-codec` they cannot. Useful
 * for telling the operator which of the two applies. Carried by
 * {@link RadioSupport}.
 *
 * @category Radio
 */
export type RadioUnsupportedReason = "insecure-context" | "no-codec";

/**
 * What {@link radioSupportStatus} returns: `{ supported: true }`, or
 * `supported: false` with the `reason` and the WebCodecs constructors that were
 * missing. Useful for telling the operator why the radio is unavailable. Returned
 * by {@link radioSupportStatus}.
 *
 * @category Radio
 */
export type RadioSupport =
  | {
      /** The browser can run the radio. */
      supported: true;
    }
  | {
      /** The browser cannot run the radio. */
      supported: false;
      /** Why not. */
      reason: RadioUnsupportedReason;
      /** The names from {@link RADIO_REQUIRED_GLOBALS} that were absent.
       *  Empty for `insecure-context`, which is diagnosed before the
       *  globals are consulted at all. */
      missing: readonly string[];
    };

/**
 * Returns whether this browser can run the radio, and why not when it
 * cannot. Useful for telling the operator whether the radio is available and
 * why not, so a page served over plain http says so. Prefer it to
 * {@link isRadioSupported} wherever the result is shown. Used by the app's radio
 * hook.
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
 *  WebCodecs constructor it needs. Useful for hiding radio controls the
 *  browser cannot run. {@link radioSupportStatus} also says why not.
 *
 * @category Radio
 * @categoryDescription Radio
 * Whether this browser can carry live push-to-talk radio, and the audio
 * settings the radio encodes and decodes with. This package does not send or
 * play audio itself: it tells a client whether it may and what to encode with.
 *
 * To speak, encode microphone audio as Opus packets of 20 ms with
 * {@link RADIO_ENCODER_CONFIG} and send about 200 ms of them at a time with the
 * `commcast.radio.transmit` command, whose arguments are
 * {@link CommcastRadioTransmitArgs}. To listen, read the `commcast.radio`
 * Topic. It is not a typed Topic, so it has no `TopicId` and is not in the
 * Topics list: it arrives as binary frames, read with
 * {@link decodeBinaryFrame}, and the first segment of each is a
 * {@link CommcastRadioBatch} describing who is speaking, followed by the Opus
 * packets to decode with {@link RADIO_DECODER_CONFIG}.
 */
export function isRadioSupported(): boolean {
  return radioSupportStatus().supported;
}
