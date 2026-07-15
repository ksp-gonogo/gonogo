/**
 * Single documented source of truth for the browser capabilities gonogo
 * cares about, and the predicates UI uses to degrade gracefully. Feature
 * detection for Web Serial lives in `webSerialSupport.ts` (it also
 * distinguishes insecure-context from unsupported-browser); this module
 * re-exposes the boolean and enumerates the Chromium-only surfaces so the
 * "what only works in Chrome" list has one home.
 */
export { isWebSerialSupported as hasWebSerial } from "./webSerialSupport";

/** Surfaces that only function in Chromium-family browsers. Firefox/Safari
 *  render the app but must offer a graceful fallback for each of these. */
export const CHROMIUM_ONLY_SURFACES = [
  {
    id: "web-serial",
    label: "Serial input devices",
    reason:
      "Web Serial (navigator.serial) is implemented only in Chromium browsers.",
  },
] as const;

/**
 * The Gamepad API is cross-browser (Chrome, Firefox, Safari all implement
 * it), unlike Web Serial — so it is deliberately NOT in
 * `CHROMIUM_ONLY_SURFACES`. The web-serial-unsupported banner must stay
 * scoped to web-serial devices; gate gamepad UI on this predicate instead,
 * never on `hasWebSerial`.
 */
export function hasGamepad(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator & { getGamepads?: unknown }).getGamepads ===
      "function"
  );
}
