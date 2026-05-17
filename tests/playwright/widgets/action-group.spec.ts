/**
 * Widget DOM mirror — ActionGroup. Asserts the label + state indicator
 * match on host and station.
 *
 * The recorded fixture has `v.sasValue = false`, so configuring the
 * widget for action group "SAS" produces a deterministic OFF readout:
 *   - Group label: "SAS"
 *   - State indicator: "OFF"
 *
 * `v.sasValue` is one of the few action-group-style keys present in the
 * frozen snapshot (f.ag1–f.ag10, v.brake, v.lights, v.gear are all
 * missing — those would render as "—" / unknown), so it's the right
 * choice for a host/station mirror assertion.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — ActionGroup", () => {
  test("SAS OFF state mirrors across host and station", async ({ browser }) => {
    const pair = await bootstrapPair(browser, "action-group", {
      widget: { config: { actionGroupId: "SAS" } },
      waitForMain: async (page) => {
        await expect(page.getByText("SAS", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(page.getByText("SAS", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("OFF", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }

    await teardownPair(pair);
  });
});
