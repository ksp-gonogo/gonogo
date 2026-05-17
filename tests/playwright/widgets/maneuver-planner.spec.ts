/**
 * Widget DOM mirror — ManeuverPlanner. Asserts the panel title and both
 * section titles render identically on host and station.
 *
 * The recorded fixture actually does ship a single maneuver node in
 * `o.maneuverNodes` (1146 m/s prograde burn from a launch-pad save),
 * so `useManeuverNodes` returns a non-empty list and ManeuverNodeList
 * renders a NodeRow — not the "No maneuver nodes planned." empty
 * state. The section titles `Planned nodes` and `New maneuver` sit
 * outside the waiting / preview ternary, so they're the most
 * deterministic strings.
 *
 * Seeded at the widget's registered defaultSize (10x18); the helper's
 * default 8x6 would be clamped up by `applyMinSizes` anyway, but
 * passing it explicitly avoids the surprise.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — ManeuverPlanner", () => {
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
      await expect(
        page.getByText("New maneuver", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
    }

    await teardownPair(pair);
  });
});
