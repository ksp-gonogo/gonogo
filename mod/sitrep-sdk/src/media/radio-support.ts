/**
 * Capability detection for the WebCodecs Opus path the push-to-talk radio
 * rides.
 *
 * The shape mirrors `isFrameDelaySupported()` next door: a synchronous
 * feature detect a caller runs before building anything, so an unsupported
 * browser gets a reported fact instead of a broken pipeline. It differs in
 * one way, and the difference is the whole reason this module exists.
 *
 * **A presence check alone gets the answer wrong, in both directions.**
 * `AudioEncoder`/`AudioDecoder` are secure-context-gated, and the engines
 * disagree about how that gate shows up. Measured 2026-09-05 against this
 * repo's own cached Playwright browsers on a plain-http LAN origin:
 * chromium and firefox leave both constructors `undefined`, while webkit
 * exposes them and would fail later, at `getUserMedia`. So a probe that
 * only asks "is `AudioEncoder` a function" reports a codec gap for the two
 * engines whose codec is fine, and reports success for the one engine that
 * is about to be refused a microphone. Neither answer is true.
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
 * The WebCodecs constructors the radio pipeline needs, named once so the
 * runtime detect and the Playwright probe cannot drift apart.
 *
 * `AudioData` and `EncodedAudioChunk` are present even on an insecure
 * origin in all three engines, so they never discriminate; the encoder and
 * decoder are the two that do. All four are listed because all four are
 * used.
 */
export const RADIO_REQUIRED_GLOBALS = [
  "AudioEncoder",
  "AudioDecoder",
  "AudioData",
  "EncodedAudioChunk",
] as const;

/**
 * The encoder configuration the radio transmits at, and the one the probe
 * measures. 20 ms of mono 48 kHz per chunk; `bitrate` is a hint that
 * firefox overshoots, so size buffers and budgets against the measured
 * rate rather than this number.
 */
export const RADIO_ENCODER_CONFIG = {
  codec: "opus",
  sampleRate: 48_000,
  numberOfChannels: 1,
  bitrate: 24_000,
} as const;

/** The decoder half of {@link RADIO_ENCODER_CONFIG}: no bitrate, since a
 *  decoder is told what the stream is rather than what to aim for. */
export const RADIO_DECODER_CONFIG = {
  codec: "opus",
  sampleRate: 48_000,
  numberOfChannels: 1,
} as const;

/** Samples per encoded chunk at {@link RADIO_ENCODER_CONFIG}'s sample
 *  rate: 20 ms, the grid Opus and the design's wire frame both use. */
export const RADIO_CHUNK_FRAMES = 960;

/** Why the radio cannot run here. `insecure-context` is recoverable by the
 *  operator (reach the page over https or via localhost); `no-codec` is
 *  not. */
export type RadioUnsupportedReason = "insecure-context" | "no-codec";

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
 * The full verdict, with the reason attached. Prefer this over
 * {@link isRadioSupported} anywhere the answer is shown to an operator: a
 * page served over plain http wants "not a secure origin", not "no codec".
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

/** True when this page can run the radio's encode/decode path at all: a
 *  secure context exposing every WebCodecs constructor it needs. The
 *  boolean twin of {@link radioSupportStatus}, for callers that only branch
 *  on it. */
export function isRadioSupported(): boolean {
  return radioSupportStatus().supported;
}
