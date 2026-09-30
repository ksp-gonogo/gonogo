/*
 * The origin is checked FIRST: some engines withhold navigator.mediaDevices on
 * an insecure origin and some expose it and refuse at getUserMedia, so a
 * presence-only probe misreports both.
 */

/**
 * Why microphone capture cannot run on this page: `insecure-origin` (plain
 * http, which works again over https or on localhost) or `no-media-devices`
 * (the browser has no media device interface at all).
 *
 * @category AudioInputPicker
 */
export type AudioCaptureUnsupportedReason =
  | "insecure-origin"
  | "no-media-devices";

/**
 * What {@link audioCaptureSupport} reports: supported, or not with the reason.
 *
 * @category AudioInputPicker
 */
export type AudioCaptureSupport =
  | { supported: true }
  | { supported: false; reason: AudioCaptureUnsupportedReason };

/**
 * Whether this page can open a microphone, probed synchronously before touching
 * a device. It reports a reason rather than a boolean because the two failures
 * need different copy.
 *
 * @category AudioInputPicker
 */
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
