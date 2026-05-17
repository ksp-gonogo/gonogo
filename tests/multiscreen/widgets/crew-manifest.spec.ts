/**
 * Widget DOM mirror — CrewManifest. Asserts the roster + headcount
 * render identically on host and station.
 *
 * Frozen end-of-recording snapshot from the replay fixture:
 *   - v.crewCount    = 1
 *   - v.crewCapacity = 1
 *   - v.crew         = ["Bob Kerman"]
 *   - v.isEVA        = false
 *
 * At the default 8×6 grid footprint the widget renders the full
 * subtitle ("1 / 1 aboard") and the roster row for Bob Kerman.
 *
 * One test, two pages, one set of assertions per side. Keep this scope —
 * widget-level invariants belong in the component's own unit tests.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — CrewManifest", () => {
  test("roster + headcount mirror across host and station", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "crew-manifest", {
      waitForMain: async (page) => {
        await expect(page.getByText("CREW", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(page.getByText("1 / 1 aboard", { exact: true })).toBeVisible(
        { timeout: 15_000 },
      );
      await expect(page.getByText("Bob Kerman", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }

    await teardownPair(pair);
  });
});
