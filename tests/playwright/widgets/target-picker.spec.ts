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
  // FIXME(fixture): TargetPicker's whole list (Bodies/Vessels/Parts tabs)
  // derives from the `target.available` stream Topic, which the recorded
  // replay fixture does NOT carry (sitrep-stream-server.mjs SNAPSHOT omits it,
  // and its header warns against adding topics carelessly). So the widget sits
  // on "Waiting for target list…" and never renders its tabs. This is NOT the
  // consent/loader issue (the consent fix merely unmasked it, and it is NOT a
  // kos dependency — the list is not a kos feed) — it needs a fixture-design
  // decision to add a synthetic `target.available` to the curated recording.
  // Tracked separately; see the fleet report 2026-07-26.
  test.fixme("title, tabs, and no-target header mirror across host and station", async ({
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
