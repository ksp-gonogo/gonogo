/**
 * Widget DOM mirror — DistanceToTarget. Asserts the panel title and the
 * no-target placeholder match on host and station.
 *
 * The recorded fixture's final snapshot has tar.name = "No Target Selected."
 * — the KSP NO_TARGET_SENTINEL, which `resolveTargetName` maps to undefined.
 * So the widget takes its no-target branch and renders the TARGET panel with
 * the "No target set in KSP" placeholder (not a tracking readout). PBDS
 * mirrors the same value to the station, so both sides read identically.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — DistanceToTarget", () => {
  test("no-target placeholder mirrors across host and station", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "distance-to-target", {
      waitForMain: async (page) => {
        await expect(page.getByText("TARGET", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(page.getByText("TARGET", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByText("No target set in KSP", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
    }

    await teardownPair(pair);
  });
});
