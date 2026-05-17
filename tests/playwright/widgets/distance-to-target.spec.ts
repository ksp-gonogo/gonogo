/**
 * Widget DOM mirror — DistanceToTarget. Asserts the panel title plus the
 * tracking-mode readouts match on host and station.
 *
 * The recorded fixture's final snapshot has:
 *   tar.name     = "No Target Selected."
 *   tar.type     = ""
 *   tar.distance = 0
 *
 * `tar.name` is a string (not undefined), so the widget does NOT take its
 * `tarName === undefined` "no target set in KSP" branch. Instead it lands
 * in tracking mode (tarType is "" / not dockable, so the docking-HUD
 * auto-switch never fires) and renders the TARGET panel with the literal
 * `tar.name` string and `formatDistance(0)` → "0 m".
 *
 * Both sides should read identically — PBDS mirrors the same value to the
 * station — so we assert the title, the target name, and the distance
 * readout on both pages.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — DistanceToTarget", () => {
  test("tracking readout mirrors across host and station", async ({
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
        page.getByText("No Target Selected.", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("0 m", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }

    await teardownPair(pair);
  });
});
