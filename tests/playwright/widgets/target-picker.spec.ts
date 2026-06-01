/**
 * Widget DOM mirror — TargetPicker. Asserts the panel title, tab labels, and
 * the no-target header state mirror across host and station.
 *
 * The recorded fixture's final snapshot has tar.name = "No Target Selected."
 * — the KSP NO_TARGET_SENTINEL, which `resolveTargetName` maps to undefined.
 * So the header renders the title and tabs but NOT the current-target chip
 * (it only appears when a target is set). The tab labels render regardless of
 * data state, so they're a stable mirror assertion.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — TargetPicker", () => {
  test("title, tabs, and no-target header mirror across host and station", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "target-picker", {
      waitForMain: async (page) => {
        await expect(
          page.getByText("TARGET PICKER", { exact: true }),
        ).toBeVisible({ timeout: 30_000 });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(
        page.getByText("TARGET PICKER", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("tab", { name: "Bodies" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole("tab", { name: "Vessels" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole("tab", { name: "Current" })).toBeVisible({
        timeout: 15_000,
      });
      // No target in the fixture (NO_TARGET_SENTINEL) -> the current-target
      // chip is absent, on both screens.
      await expect(page.getByLabel(/^Current target:/)).toHaveCount(0);
    }

    await teardownPair(pair);
  });
});
