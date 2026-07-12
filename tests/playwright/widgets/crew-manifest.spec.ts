/**
 * Widget DOM mirror — CrewManifest. Asserts the panel renders on host and
 * station, and the roster + headcount render on the host.
 *
 * Fixture snapshot (`sitrep-stream-server.mjs`):
 *   - vessel.crew.count    = 1
 *   - vessel.crew.capacity = 1
 *   - vessel.crew.crew     = [{ name: "Bob Kerman" }]
 *
 * At the default 8×6 grid footprint the widget renders the full
 * subtitle ("1 / 1 aboard") and the roster row for Bob Kerman.
 *
 * Station-side scope: only the "CREW" panel title (static chrome) is
 * checked on the station — the roster/headcount come from live Sitrep
 * stream data, and only the MAIN screen mounts `SitrepTelemetryProvider`
 * today (station stream forwarding over PeerJS is a documented pending
 * gap, see that provider's own doc comment). Checking the roster on the
 * station would fail for that reason, not a widget or harness bug.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — CrewManifest", () => {
  test("panel renders on host and station; roster + headcount on host", async ({
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
      await expect(page.getByText("CREW", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }

    await expect(
      pair.main.getByText("1 / 1 aboard", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      pair.main.getByText("Bob Kerman", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    await teardownPair(pair);
  });
});
