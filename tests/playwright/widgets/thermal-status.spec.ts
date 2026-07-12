/**
 * Widget DOM mirror — ThermalStatus. Asserts the panel title on host and
 * station, and the summary pill + hottest-part identity on the host.
 *
 * Unlike PowerSystems, ThermalStatus does NOT depend on `useTopology`
 * — it reads `vessel.thermal`'s aggregate fields directly. The fixture
 * (`sitrep-stream-server.mjs`) carries every field the widget subscribes
 * to:
 *
 *   vessel.thermal.hottestPart.name            → "Mk1 Command Pod"
 *   vessel.thermal.maxInternalTempRatio         → ~0.256  (nominal, <0.75)
 *   vessel.thermal.hottestEngineTempRatio       → ~0.173  (nominal)
 *   vessel.thermal.anyEnginesOverheating        → false
 *   vessel.thermal.heatShieldTempCelsius        → -273.15 (absolute-zero
 *                                                  sentinel — widget drops
 *                                                  the shield row entirely)
 *
 * Worst band across part + engine is `nominal`, so the StatusPill reads
 * "nominal" and the row layout drops the heat-shield slot.
 *
 * Station-side scope: only the "THERMAL" panel title (static chrome) is
 * checked on the station — the pill/hottest-part readouts come from live
 * Sitrep stream data, and only the MAIN screen mounts
 * `SitrepTelemetryProvider` today (station stream forwarding over PeerJS
 * is a documented pending gap, see that provider's own doc comment).
 * Checking the readouts on the station would fail for that reason, not a
 * widget or harness bug.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — ThermalStatus", () => {
  test("panel title on host and station; nominal pill + hottest part on host", async ({
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
    }

    await expect(
      pair.main.getByText("Hottest part", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      pair.main.getByText("Mk1 Command Pod", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    await teardownPair(pair);
  });
});
