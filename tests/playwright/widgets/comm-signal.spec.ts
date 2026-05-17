/**
 * Widget DOM mirror — CommSignal. Asserts the headline readout
 * matches on host and station.
 *
 * The recorded fixture's `comm.connected` is `false` (vessel was out
 * of range at recording end), so the widget collapses to its
 * "loss of signal" state:
 *   - Subtitle: "No signal"
 *   - Headline: "LOS"
 *   - Signal bars aria-label: "Signal 0 of 4"
 *
 * One test, two pages, one assertion per side. Keep this scope —
 * widget-level invariants belong in the component's own unit tests.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — CommSignal", () => {
  test("LOS headline + subtitle mirror across host and station", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "comm-signal", {
      waitForMain: async (page) => {
        await expect(page.getByText("COMMNET", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(page.getByText("No signal", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("LOS", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByLabel("Signal 0 of 4")).toBeVisible({
        timeout: 15_000,
      });
    }

    await teardownPair(pair);
  });
});
