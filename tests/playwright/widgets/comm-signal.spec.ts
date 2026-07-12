/**
 * Widget DOM mirror — CommSignal. Asserts the panel renders on host and
 * station, and the LOS headline readout on the host.
 *
 * The fixture's `vessel.comms.connected` is `false`, so the widget
 * collapses to its "loss of signal" state:
 *   - Subtitle: "No signal"
 *   - Headline: "LOS"
 *   - Signal bars aria-label: "Signal 0 of 4"
 *
 * Station-side scope: only the "COMMNET" panel title (static chrome) is
 * checked on the station — the LOS readout comes from live Sitrep stream
 * data, and only the MAIN screen mounts `SitrepTelemetryProvider` today
 * (station stream forwarding over PeerJS is a documented pending gap, see
 * that provider's own doc comment). Checking the LOS state on the station
 * would fail for that reason, not a widget or harness bug.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — CommSignal", () => {
  test("panel renders on host and station; LOS headline on host", async ({
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
      await expect(page.getByText("COMMNET", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }

    await expect(pair.main.getByText("No signal", { exact: true })).toBeVisible(
      { timeout: 15_000 },
    );
    await expect(pair.main.getByText("LOS", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(pair.main.getByLabel("Signal 0 of 4")).toBeVisible({
      timeout: 15_000,
    });

    await teardownPair(pair);
  });
});
