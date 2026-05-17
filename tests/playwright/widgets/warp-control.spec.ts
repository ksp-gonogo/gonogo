/**
 * Widget DOM mirror — WarpControl. Asserts the rate readout matches on
 * host and station.
 *
 * The recorded fixture's final snapshot has:
 *   t.currentRate = 1
 *   t.timeWarp    = false   (boolean, never enters a high-warp index)
 *   t.warpMode    = "HIGH"
 *   t.isPaused    = false
 *
 * `t.currentRate` of 1 lands in `formatRate`'s realtime branch, so the
 * rate readout renders as "1×" with aria-label "Time warp rate 1×". The
 * fixture has no `kc.scene` entry so `useGameContext` returns
 * `hasGameSignal=false`, which means `dimBody=false` and the body
 * renders normally.
 *
 * Both sides should read identically — PBDS mirrors `t.currentRate` and
 * `t.warpMode` to the station — so we assert the panel title and the
 * rate readout (via its stable aria-label) on both pages.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — WarpControl", () => {
  test("rate readout mirrors across host and station", async ({ browser }) => {
    const pair = await bootstrapPair(browser, "warp-control", {
      waitForMain: async (page) => {
        await expect(page.getByText("WARP", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(page.getByText("WARP", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByLabel("Time warp rate 1×")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByLabel("Time warp rate 1×")).toHaveText("1×");
    }

    await teardownPair(pair);
  });
});
