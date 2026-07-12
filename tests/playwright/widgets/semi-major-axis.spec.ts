/**
 * Widget DOM mirror — SemiMajorAxis. Asserts the panel renders on host
 * and station, and the SMA readout on the host.
 *
 * The fixture's `vessel.orbit.sma` is `773862.315964763` (metres), which
 * lands in formatDistance's `>= 1e3` branch:
 *   (773862.315964763 / 1e3).toFixed(1) → "773.9 km"
 *
 * Station-side scope: only the "SMA" panel title (static chrome) is
 * checked on the station — the readout comes from live Sitrep stream
 * data, and only the MAIN screen mounts `SitrepTelemetryProvider` today
 * (station stream forwarding over PeerJS is a documented pending gap, see
 * that provider's own doc comment). Checking the readout on the station
 * would fail for that reason, not a widget or harness bug.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — SemiMajorAxis", () => {
  test("panel renders on host and station; SMA readout on host", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "semi-major-axis", {
      waitForMain: async (page) => {
        await expect(page.getByText("SMA", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(page.getByText("SMA", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }

    await expect(pair.main.getByText("773.9 km", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await teardownPair(pair);
  });
});
