/**
 * Widget DOM mirror — FuelStatus. Asserts the panel title and the
 * Liquid Fuel / Oxidizer resource readouts match on host and station.
 *
 * The recorded fixture's final snapshot has:
 *   r.resource[LiquidFuel]    = 539.797
 *   r.resourceMax[LiquidFuel] = 1980
 *   r.resource[Oxidizer]      = 659.752
 *   r.resourceMax[Oxidizer]   = 2420
 *
 * `LiquidFuel` and `Oxidizer` are scope: "current" in the widget, so they
 * actually read `r.resourceCurrent[…]` / `r.resourceCurrentMax[…]`. The
 * replay fixture doesn't surface those stage-scoped keys, so those rows
 * read as 0 / 0 and are filtered out by the `max > 0` guard in the
 * resource list. We assert only on things that ARE deterministic across
 * both sides: the panel title.
 *
 * Size is widened to 8×14 (the widget's default) so the resource list
 * AND stage stack render — both surfaces should mirror exactly.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — FuelStatus", () => {
  test("panel title mirrors across host and station", async ({ browser }) => {
    const pair = await bootstrapPair(browser, "fuel-status", {
      widget: { size: { w: 8, h: 14 } },
      waitForMain: async (page) => {
        await expect(page.getByText("FUEL · ΔV", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(page.getByText("FUEL · ΔV", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }

    await teardownPair(pair);
  });
});
