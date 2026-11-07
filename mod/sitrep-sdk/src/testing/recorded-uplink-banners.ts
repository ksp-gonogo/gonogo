import type { UplinkClientHandle } from "../api/types";
import type { UplinkBanner } from "../api/uplink-banner";

/**
 * A banner an Uplink raised through `raiseUplinkBanner` under a test host,
 * with the id of the Uplink that raised it. Read them with
 * {@link getRaisedBanners}. Useful for testing that a condition in an Uplink's
 * client raises the banner the operator should see.
 *
 * @category Test doubles
 */
export interface RecordedUplinkBanner extends UplinkBanner {
  /** The id of the Uplink client handle passed to `raiseUplinkBanner`. */
  uplinkId: string;
}

const raised = new Map<string, RecordedUplinkBanner>();

const keyOf = (uplinkId: string, id: string) => `${uplinkId}\u0000${id}`;

/**
 * The banners raised and not cleared since the last reset, in the order they
 * were first raised. Raising an id again replaces its entry, as the app does,
 * and the app's limits and the operator's dismissal are not applied. Useful for
 * testing that an Uplink raises a banner when a condition starts and clears it
 * when the condition ends.
 *
 * @example
 * ```ts
 * import { clearRaisedBanners, getRaisedBanners } from "@ksp-gonogo/sitrep-sdk/testing";
 * import { afterEach, expect, it } from "vitest";
 *
 * afterEach(clearRaisedBanners);
 *
 * it("raises one banner", () => {
 *   // ...make the condition happen, then:
 *   expect(getRaisedBanners().map((b) => b.id)).toEqual(["link-lost"]);
 * });
 * ```
 *
 * @category Test doubles
 */
export function getRaisedBanners(): readonly RecordedUplinkBanner[] {
  return [...raised.values()];
}

/**
 * Forgets every recorded banner. Call it between tests. Useful for starting
 * each test of an Uplink's banners with none raised.
 *
 * @category Test doubles
 */
export function clearRaisedBanners(): void {
  raised.clear();
}

/** The `raiseUplinkBanner` member `installRealTestHost` wires. */
export function recordRaisedBanner(
  owner: UplinkClientHandle,
  banner: UplinkBanner,
): void {
  raised.set(keyOf(owner.id, banner.id), { ...banner, uplinkId: owner.id });
}

/** The `clearUplinkBanner` member `installRealTestHost` wires. */
export function recordClearedBanner(
  owner: UplinkClientHandle,
  id: string,
): void {
  raised.delete(keyOf(owner.id, id));
}
