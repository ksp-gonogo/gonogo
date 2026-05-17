/**
 * Widget DOM mirror — TargetPicker. Asserts the panel title, tab labels,
 * and the current-target chip mirror across host and station.
 *
 * The recorded fixture's final snapshot has:
 *   tar.name = "No Target Selected."
 *   tar.type = ""
 *   tar.distance = 0
 *
 * `tar.name` is a string (not undefined), so the widget renders the
 * `CurrentTargetChip` in its header with the literal `tar.name` text —
 * KSP itself reports "No Target Selected." as the active target name
 * when nothing is locked, and the widget pipes that straight through.
 *
 * Default tab is "bodies"; the widget's Tabs row labels ("Bodies",
 * "Vessels", "Current") render regardless of data state, so they're a
 * stable mirror assertion that doesn't depend on the kOS data source
 * (which isn't running in tests).
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — TargetPicker", () => {
  test("panel title + tabs + current-target chip mirror across host and station", async ({
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
      await expect(
        page.getByRole("tab", { name: "Bodies" }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByRole("tab", { name: "Vessels" }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByRole("tab", { name: "Current" }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByLabel(
          "Current target: No Target Selected.. Open Current tab.",
        ),
      ).toBeVisible({ timeout: 15_000 });
    }

    await teardownPair(pair);
  });
});
