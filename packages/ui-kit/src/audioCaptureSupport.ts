/**
 * Whether this page can open a microphone at all, and when it cannot, which of
 * the two reasons it is.
 *
 * The shape deliberately mirrors the radio's `radioSupportStatus()`: a
 * synchronous probe a caller runs BEFORE touching a device, reporting a reason
 * rather than a boolean. A boolean is not enough here because the two
 * unsupported states are different facts to an operator and want different
 * copy: a page served over plain http can be reached again over https or
 * localhost, a browser with no media device interface cannot.
 *
 * The context is asked about FIRST, and that order is the point. Engines
 * disagree about how the secure-context gate shows up on
 * `navigator.mediaDevices`: some withhold the object entirely on an insecure
 * origin, some expose it and refuse at `getUserMedia`. A presence-only probe
 * therefore reports "this browser has no media devices" for a browser whose
 * media devices are fine, and reports success for one that is about to refuse.
 * Asking about the origin first makes both engines say the same true thing.
 *
 * This is not a hypothetical origin: `packages/app/vite.config.ts` sets
 * `server: { host: true }`, so a station opened at `http://<lan-ip>:5173` lands
 * in the insecure state every time. Production over https, and localhost dev,
 * are both secure.
 */

/** Why microphone capture cannot run on this page. */
export type AudioCaptureUnsupportedReason =
  | "insecure-origin"
  | "no-media-devices";

export type AudioCaptureSupport =
  | { supported: true }
  | { supported: false; reason: AudioCaptureUnsupportedReason };

/** The verdict, with the reason attached. */
export function audioCaptureSupport(): AudioCaptureSupport {
  /*
   * `!== true` rather than a truthiness test: a host that is not a browser
   * does not define `isSecureContext` at all, and anything other than the
   * boolean a browser sets is a host we do not recognise. Guessing in its
   * favour is how a probe goes green somewhere the microphone is refused.
   */
  if (
    !("isSecureContext" in globalThis) ||
    globalThis.isSecureContext !== true
  ) {
    return { supported: false, reason: "insecure-origin" };
  }

  const media =
    typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!media || typeof media.getUserMedia !== "function") {
    return { supported: false, reason: "no-media-devices" };
  }
  return { supported: true };
}
