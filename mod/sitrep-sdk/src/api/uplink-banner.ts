import { getHost } from "./host";
import type { UplinkClientHandle } from "./types";

/**
 * How serious a banner is, which sets its colour and how it is announced:
 * `"info"` for a fact worth noticing, `"warning"` for something that needs
 * attention soon, `"critical"` for something that needs it now and is
 * announced to assistive technology as an alert. Useful for telling the
 * operator how urgently to read an {@link UplinkBanner}.
 *
 * @category Banners
 */
export type UplinkBannerSeverity = "info" | "warning" | "critical";

/**
 * The one control a banner may carry, a button the operator presses to act on
 * what the banner says. Useful for offering the fix beside the problem, such as
 * "Retry" on a lost connection. Used as the `action` of an
 * {@link UplinkBanner}.
 *
 * @category Banners
 */
export interface UplinkBannerAction {
  /** The button's text, a verb such as `"Retry"`. */
  label: string;
  /** Called when the operator presses the button. The banner stays until the Uplink clears it. */
  onAction: () => void;
}

/**
 * A banner an Uplink puts in the operator's banner stack, the strip of
 * notices at the bottom right of the screen, beside the alarms. Useful for telling
 * the operator about a condition that is not tied to one widget, such as a
 * partner mod losing contact with its server. Passed to {@link raiseUplinkBanner}.
 *
 * @category Banners
 */
export interface UplinkBanner {
  /**
   * Your Uplink's name for this banner, such as `"link-lost"`. Other Uplinks'
   * ids never clash with yours. Raising an id you already have a banner for
   * updates that banner instead of adding another.
   */
  id: string;
  /** See {@link UplinkBannerSeverity}. */
  severity: UplinkBannerSeverity;
  /**
   * What the banner says, as the operator reads it: one short sentence naming
   * the condition, not the Uplink (the banner names the Uplink itself). Text
   * longer than {@link UPLINK_BANNER_LIMITS}`.maxTextLength` is cut.
   */
  text: string;
  /** An optional button beside the text. See {@link UplinkBannerAction}. */
  action?: UplinkBannerAction;
}

/**
 * The limits Gonogo applies to the banners of one Uplink, so that no Uplink can
 * fill the operator's banner stack. Useful for staying inside them: a banner
 * raised past `maxBanners` with an id the Uplink has no banner for is not
 * shown and is logged as a warning, and text past `maxTextLength` characters is
 * cut. Applied by {@link raiseUplinkBanner}.
 *
 * @category Banners
 */
export const UPLINK_BANNER_LIMITS = {
  /** The most banners one Uplink can have showing at once. */
  maxBanners: 3,
  /** The most characters of text a banner shows. */
  maxTextLength: 160,
} as const;

/**
 * Shows a banner in the operator's banner stack on behalf of your Uplink.
 * Useful for telling the operator about a condition that is not tied to one
 * widget, such as a partner mod losing contact with its server. Pass the handle
 * {@link defineUplinkClient} returned, so the banner is labelled with your
 * Uplink's name. Raising an id you already have a banner for updates that
 * banner. The operator can dismiss a banner; it stays dismissed until you raise
 * the same id with a different severity or text. The banner shows on the
 * screen the client code runs on, main screen or station, and stays until you
 * call {@link clearUplinkBanner}. Limits are in {@link UPLINK_BANNER_LIMITS}.
 *
 * @example
 * ```ts
 * import { defineUplinkClient, raiseUplinkBanner, clearUplinkBanner } from "@ksp-gonogo/sitrep-sdk";
 *
 * const MY_UPLINK = defineUplinkClient({
 *   id: "myuplink",
 *   version: "1.0.0",
 *   name: "My Uplink",
 *   description: "Shows the state of a partner mod's server.",
 * });
 *
 * function onLinkChanged(up: boolean, reconnect: () => void) {
 *   if (up) clearUplinkBanner(MY_UPLINK, "link-lost");
 *   else
 *     raiseUplinkBanner(MY_UPLINK, {
 *       id: "link-lost",
 *       severity: "warning",
 *       text: "Contact with the server was lost",
 *       action: { label: "Retry", onAction: reconnect },
 *     });
 * }
 * ```
 *
 * @category Banners
 */
export function raiseUplinkBanner(
  owner: UplinkClientHandle,
  banner: UplinkBanner,
): void {
  // gonogo:reads none
  getHost().raiseUplinkBanner(owner, banner);
}

/**
 * Removes a banner your Uplink raised, for when the condition it named has
 * passed. Useful for taking a notice down the moment it stops being true. Does
 * nothing when you have no banner with that id, or when the operator already
 * dismissed it.
 *
 * @category Banners
 */
export function clearUplinkBanner(owner: UplinkClientHandle, id: string): void {
  // gonogo:reads none
  getHost().clearUplinkBanner(owner, id);
}
