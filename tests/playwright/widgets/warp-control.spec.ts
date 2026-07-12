/**
 * Widget DOM mirror — WarpControl. Asserts the panel title on host and
 * station, and the rate readout on the host.
 *
 * The fixture's `time.warp` snapshot (`sitrep-stream-server.mjs`) has:
 *   warpRate      = 1
 *   warpRateIndex = 0
 *   warpMode      = WarpMode.High
 *   paused        = false
 *
 * `warpRate` of 1 lands in `formatRate`'s realtime branch, so the rate
 * readout renders as "1×" with aria-label "Time warp rate 1×".
 *
 * Station-side scope: only the "WARP" panel title (static chrome) is
 * checked on the station — the rate readout comes from live Sitrep stream
 * data (`useTelemetry("time.warp")`, the canonical single-arg form with no
 * legacy fallback), and only the MAIN screen mounts
 * `SitrepTelemetryProvider` today (station stream forwarding over PeerJS
 * is a documented pending gap, see that provider's own doc comment).
 * Checking the readout on the station would fail for that reason, not a
 * widget or harness bug.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — WarpControl", () => {
  test("panel title on host and station; rate readout on host", async ({
    browser,
  }) => {
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
    }

    await expect(pair.main.getByLabel("Time warp rate 1×")).toBeVisible({
      timeout: 15_000,
    });
    await expect(pair.main.getByLabel("Time warp rate 1×")).toHaveText("1×");

    await teardownPair(pair);
  });
});
