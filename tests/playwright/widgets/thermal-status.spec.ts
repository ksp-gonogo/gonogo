/**
 * Widget DOM mirror — ThermalStatus. Asserts the panel title, summary
 * pill, and the hottest-part identity all render the same on host and
 * station.
 *
 * Unlike PowerSystems, ThermalStatus does NOT depend on `useTopology`
 * — it reads aggregate `therm.*` keys directly off the `data` source.
 * The replay fixture includes every key the widget subscribes to:
 *
 *   therm.hottestPartName       → "Mk1 Command Pod"
 *   therm.hottestPartTempRatio  → ~0.256  (nominal, <0.75)
 *   therm.hottestEngineTempRatio→ ~0.173  (nominal)
 *   therm.anyEnginesOverheating → false
 *   therm.heatShieldTempCelsius → -273.15 (absolute-zero sentinel —
 *                                 widget drops the shield row entirely)
 *
 * Worst band across part + engine is `nominal`, so the StatusPill reads
 * "nominal" and the row layout drops the heat-shield slot. Those three
 * facts — panel title, pill label, hottest-part name — are deterministic
 * end-of-recording state and are the cross-screen invariant this test
 * guards. Band-colour / sentinel / shrink-mode rendering is exercised
 * in the widget's own unit tests.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — ThermalStatus", () => {
  test("panel title + nominal pill + hottest part mirror across host and station", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "thermal-status", {
      waitForMain: async (page) => {
        await expect(page.getByText("THERMAL", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(page.getByText("THERMAL", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("Hottest part", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByText("Mk1 Command Pod", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
    }

    await teardownPair(pair);
  });
});
