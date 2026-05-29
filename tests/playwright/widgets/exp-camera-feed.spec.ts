import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

/**
 * Tier-1 smoke test for the ExpCameraFeed widget.
 *
 * Asserts the panel renders with the correct title and shows the
 * "no cameras detected" placeholder when no kerbcam sidecar is reachable
 * (which is always the case in CI). The WebRTC handshake, stream playback,
 * zoom/pan controls, and SIGNAL LOST overlay are exercised by the
 * vitest suite (ExpCameraFeed.test.tsx) where a controlled fake transport
 * lets us drive the sidecar protocol synchronously.
 */

test.describe("ExpCameraFeed — widget scaffold", () => {
  test("renders title and no-sidecar placeholder on host + station", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "exp-camera-feed", {
      widget: {
        config: {
          flightId: null,
        },
      },
      waitForMain: async (page) => {
        await expect(page.getByText("Camera Feed (exp)").first()).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    for (const page of [pair.main, pair.station]) {
      // Panel title
      await expect(page.getByText("Camera Feed (exp)").first()).toBeVisible();

      // Either the "no cameras detected" message (kerbcam not connected)
      // or the "waiting for sidecar handshake" subtitle — either is correct
      // in CI where no sidecar is running.
      const noCamerasText = page.getByText(/no cameras detected/i).first();
      const waitingText = page
        .getByText(/waiting for sidecar handshake/i)
        .first();
      const hasNoCameras = await noCamerasText.isVisible();
      const hasWaiting = await waitingText.isVisible();
      expect(
        hasNoCameras || hasWaiting,
        `Expected placeholder text on ${page.url()}`,
      ).toBe(true);
    }

    await teardownPair(pair);
  });
});
