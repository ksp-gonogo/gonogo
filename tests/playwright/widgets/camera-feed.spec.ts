import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

/**
 * Tier-1 smoke test for the CameraFeed widget.
 *
 * Asserts the panel renders with the correct title and shows the
 * no-cameras placeholder when no kerbcam sidecar is reachable (always
 * the case in CI). The WebRTC handshake, stream playback, zoom/pan
 * controls, and SIGNAL LOST overlay are exercised by the vitest suite
 * (CameraFeed.test.tsx) where a controlled fake transport lets us drive
 * the sidecar protocol synchronously.
 */

test.describe("CameraFeed — widget scaffold", () => {
  test("renders title and no-sidecar placeholder on host + station", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "camera-feed", {
      widget: {
        config: {
          flightId: null,
        },
      },
      waitForMain: async (page) => {
        await expect(page.getByText("Camera Feed").first()).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    for (const page of [pair.main, pair.station]) {
      // Panel title
      await expect(page.getByText("Camera Feed").first()).toBeVisible();

      // With no sidecar/cameras (always the case in CI) the widget shows
      // the "no cameras on this vessel" subtitle plus the empty-state body
      // ("No camera feeds — start a vessel with Hullcam parts installed").
      const noCamerasSubtitle = page
        .getByText(/no cameras on this vessel/i)
        .first();
      const emptyBody = page.getByText(/no camera feeds/i).first();
      const hasSubtitle = await noCamerasSubtitle.isVisible();
      const hasEmpty = await emptyBody.isVisible();
      expect(
        hasSubtitle || hasEmpty,
        `Expected no-cameras placeholder on ${page.url()}`,
      ).toBe(true);
    }

    await teardownPair(pair);
  });
});
