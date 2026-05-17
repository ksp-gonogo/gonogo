/**
 * Station observes host disconnect after the dashboard has mounted.
 * Pairs with HostDisconnectBanner in packages/app/src/peer/.
 *
 * Before the banner landed, closing the host page mid-mission left the
 * station UI completely unchanged — telemetry just stopped updating
 * and the operator had no on-screen signal that anything had broken.
 * This test guards that the banner now fires within a few seconds of
 * losing the host.
 *
 * The banner copy ranges between "RECONNECTING TO HOST…" (warning) and
 * "HOST DISCONNECTED" (nogo) depending on whether PeerJS is still
 * trying. Either text proves the banner is up.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "./helpers";

test.describe("host disconnect — station banner", () => {
  test("station shows a host-lost banner after the main page closes", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "comm-signal", {
      waitForMain: async (page) => {
        await expect(page.getByText("COMMNET", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    // No banner while connected.
    await expect(
      pair.station.getByText(/RECONNECTING TO HOST…|HOST DISCONNECTED/),
    ).not.toBeVisible();

    // Drop the host.
    await pair.main.close();

    // Within ~30s the station should surface either the reconnecting
    // or disconnected copy. PeerJS's reconnect cadence varies (the
    // local broker disconnect is fast, the data-channel close
    // less so), so we accept either pill.
    await expect(
      pair.station.getByText(/RECONNECTING TO HOST…|HOST DISCONNECTED/),
    ).toBeVisible({ timeout: 30_000 });

    await pair.station.close();
    await pair.mainContext.close();
    await pair.stationContext.close();
  });
});
