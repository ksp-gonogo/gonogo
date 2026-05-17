/**
 * Widget DOM mirror — PowerSystems. Asserts the panel title and the
 * pre-data hint render the same on host and station.
 *
 * The recorded fixture has `r.resource[ElectricCharge] = 448.802`
 * (~99.7% of the 450-unit cap) — but the widget's surface is driven by
 * `useTopology("data") + usePartsLive(flightIds)`, NOT raw `r.resource`.
 * The replay fixture does not include `v.topology` / `v.topologySeq`
 * keys, so `useTopology` resolves to `undefined` and the widget falls
 * into its early-return branch:
 *
 *   <PanelTitle>POWER SYSTEMS</PanelTitle>
 *   <Hint>Waiting for vessel topology…</Hint>
 *
 * Both states are deterministic and must mirror exactly across host
 * and station. That's the cross-screen invariant this test guards —
 * the EC%/per-part-flow rendering is exercised in the widget's own
 * unit tests where topology can be supplied directly.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — PowerSystems", () => {
  test("panel title + pre-topology hint mirror across host and station", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "power-systems", {
      waitForMain: async (page) => {
        await expect(
          page.getByText("POWER SYSTEMS", { exact: true }),
        ).toBeVisible({ timeout: 30_000 });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(
        page.getByText("POWER SYSTEMS", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText("Waiting for vessel topology…", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
    }

    await teardownPair(pair);
  });
});
