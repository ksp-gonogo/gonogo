/**
 * Widget DOM mirror: ManeuverPlanner. Asserts the panel title and both
 * section titles render identically on host and station.
 *
 * The recorded fixture does NOT ship any maneuver node, it carries no
 * `vessel.maneuver` (nor the legacy `o.maneuverNodes`), so `useManeuverNodes`
 * returns an empty list and ManeuverNodeList shows its empty state, not a
 * NodeRow. This test does not exercise node data at all: the section titles
 * `Planned nodes` and `New maneuver` render UNCONDITIONALLY (outside the
 * waiting / preview ternary), so they green regardless of node/telemetry
 * state and are the deterministic strings to assert. (An earlier version of
 * this comment wrongly claimed the fixture ships a 1146 m/s node; it does
 * not, and nothing in the test depends on one.)
 *
 * Seeded at the widget's registered defaultSize (10x18); the helper's
 * default 8x6 would be clamped up by `applyMinSizes` anyway, but
 * passing it explicitly avoids the surprise.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror: ManeuverPlanner", () => {
  test("section titles mirror across host and station", async ({ browser }) => {
    const pair = await bootstrapPair(browser, "maneuver-planner", {
      widget: { size: { w: 10, h: 18 } },
      waitForMain: async (page) => {
        await expect(
          page.getByText("MANEUVER PLANNER", { exact: true }),
        ).toBeVisible({ timeout: 30_000 });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(
        page.getByText("MANEUVER PLANNER", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText("Planned nodes", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("New maneuver", { exact: true })).toBeVisible(
        { timeout: 15_000 },
      );
    }

    await teardownPair(pair);
  });
});
