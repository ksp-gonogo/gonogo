/**
 * Widget DOM mirror — SemiMajorAxis. Asserts the SMA readout matches
 * on host and station.
 *
 * The recorded fixture's final snapshot has `o.sma = 773862.32` (metres),
 * which lands in formatDistance's `>= 1e3` branch:
 *   (773862.32 / 1e3).toFixed(1) → "773.9 km"
 *
 * Both sides should read identically — PBDS mirrors the same value to
 * the station — so we assert the panel title and the readout on both
 * pages.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — SemiMajorAxis", () => {
  test("SMA readout mirrors across host and station", async ({ browser }) => {
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
      await expect(page.getByText("773.9 km", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }

    await teardownPair(pair);
  });
});
