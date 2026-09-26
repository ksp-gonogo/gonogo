/**
 * Whether this page can open a microphone, probed synchronously before touching
 * a device. It reports a reason rather than a boolean because the two failures
 * want different copy: plain http can be reopened over https or localhost, a
 * browser with no media device interface cannot.
 *
 * The origin is checked FIRST: some engines withhold `navigator.mediaDevices`
 * on an insecure origin and some expose it and refuse at `getUserMedia`, so a
 * presence-only probe misreports both.
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
  // Anything other than the boolean `true` a browser sets is treated as insecure.
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
