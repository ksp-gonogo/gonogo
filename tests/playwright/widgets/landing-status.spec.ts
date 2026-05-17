/**
 * Widget DOM mirror — LandingStatus. Asserts the panel header and the
 * "no landing in progress" empty state match on host and station.
 *
 * The recorded fixture ends with the vessel in a stable Kerbin orbit:
 *   v.body              = "Kerbin"
 *   v.situation         = "ORBITING"
 *   v.verticalSpeed     = +39.3   (ascending → `descending` is false)
 *   land.timeToImpact   = NaN     (no landing solution)
 *
 * `notNumber(timeToImpact)` is true, so the widget short-circuits to the
 * EmptyState. Because vertical speed is non-negative the message is the
 * "No landing in progress" branch (not "Waiting for a landing
 * prediction…"). The default 8×6 footprint keeps `showSubtitle` (rows ≥ 6)
 * true, so the "Kerbin · atmospheric" subtitle is also visible — Kerbin
 * is registered with `hasAtmosphere: true` in stock-bodies.
 *
 * PBDS mirrors the same telemetry to the station, so both pages should
 * read identically.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — LandingStatus", () => {
  test("orbit-state empty readout mirrors across host and station", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "landing-status", {
      waitForMain: async (page) => {
        await expect(page.getByText("LANDING", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(page.getByText("LANDING", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByText("Kerbin · atmospheric", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText("No landing in progress", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
    }

    await teardownPair(pair);
  });
});
