/**
 * Feature-detect the Web Serial API and, when it's missing, work out *why* so
 * the UI can give actionable advice instead of a dead-end "not supported".
 *
 * Two failure modes look identical at the `navigator.serial` level — the
 * property is simply absent in both — but have completely different fixes:
 *
 *  - **insecure-context**: the browser *does* ship Web Serial, but only exposes
 *    `navigator.serial` in a secure context (HTTPS, or http://localhost). Load
 *    the app over a plain-HTTP LAN IP and the API vanishes. This is the common
 *    "it worked on the deployed site but not the dev box over wifi" trap, and
 *    it's fixable without changing browsers.
 *  - **unsupported-browser**: iOS Safari, all iOS browsers, and desktop Firefox
 *    don't implement Web Serial at all. No amount of HTTPS will help.
 */
export type WebSerialSupport =
  | { supported: true }
  | { supported: false; reason: "insecure-context" }
  | { supported: false; reason: "unsupported-browser" };

export function getWebSerialSupport(): WebSerialSupport {
  if (typeof navigator !== "undefined") {
    const serial = (navigator as Navigator & { serial?: unknown }).serial;
    if (
      serial &&
      typeof (serial as { requestPort?: unknown }).requestPort === "function"
    ) {
      return { supported: true };
    }
  }
  // `navigator.serial` is absent. If the page isn't a secure context, that's
  // almost certainly the cause — the implementation is there but gated.
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return { supported: false, reason: "insecure-context" };
  }
  return { supported: false, reason: "unsupported-browser" };
}

export function isWebSerialSupported(): boolean {
  return getWebSerialSupport().supported;
}
