/**
 * Widget DOM mirror — AtmosphereProfile. Asserts the panel chrome
 * matches on host and station for the recorded fixture.
 *
 * The recorded fixture's final snapshot has:
 *   v.body                  = "Kerbin"
 *   v.altitude              = 100953   (>70 km → above Kerbin's atmosphere)
 *   v.atmosphericDensity    = MISSING
 *   v.atmosphericTemperature = MISSING
 *
 * Kerbin is a known body with an atmospheric model, so:
 *   - The reference pressure curve renders (no GraphView empty-state).
 *   - `pressureAtAltitude(Kerbin, 100953)` returns 0, so the
 *     `currentPressure <= 0` guard suppresses the threshold readout.
 *   - `liveDensity` is missing, so the LiveChip (ρ / Air / Skin) is
 *     suppressed.
 *   - Neither "No atmospheric model registered" nor "Unknown body"
 *     notices fire (Kerbin resolves cleanly with `body.atmosphere` set).
 *
 * That leaves the panel title as the only stable positive DOM signal
 * shared by both pages; we also assert the failure-mode notices and
 * the waiting-on-body empty state are absent to keep the test honest.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — AtmosphereProfile", () => {
  test("panel title renders on host and station with no error notices", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "atmosphere-profile", {
      waitForMain: async (page) => {
        await expect(
          page.getByText("ATMOSPHERE PROFILE", { exact: true }),
        ).toBeVisible({ timeout: 30_000 });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(
        page.getByText("ATMOSPHERE PROFILE", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText("Waiting for body telemetry…", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText(/No atmospheric model registered/),
      ).toHaveCount(0);
      await expect(page.getByText(/Unknown body/)).toHaveCount(0);
    }

    await teardownPair(pair);
  });
});
