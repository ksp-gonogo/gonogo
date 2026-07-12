/**
 * Widget DOM mirror — AtmosphereProfile. Asserts the panel chrome renders
 * on host and station, and the full happy-path state (including the
 * "waiting for body telemetry" empty state staying absent) on the host.
 *
 * The fixture (`sitrep-stream-server.mjs`) has:
 *   vessel.state.parentBodyName = "Kerbin"  (derived; needs all 8
 *                                  vessel.state inputs — see that
 *                                  channel's own doc comment)
 *   vessel.state.altitudeAsl    = null      (OnRails basis — altitude is a
 *                                  measured-basis-only field, see
 *                                  vessel-state.ts)
 *
 * Kerbin is a known body with an atmospheric model, so on the HOST:
 *   - The reference pressure curve renders (no GraphView empty-state —
 *     the "Waiting for body telemetry…" fallback only fires when `body`
 *     is `undefined`).
 *   - Neither "No atmospheric model registered" nor "Unknown body"
 *     notices fire (Kerbin resolves cleanly with `body.atmosphere` set).
 *
 * On the STATION, `bodyName` never resolves — only the MAIN screen mounts
 * `SitrepTelemetryProvider` today (station stream forwarding over PeerJS
 * is a documented pending gap, see that provider's own doc comment) — so
 * `body` stays `undefined` there and GraphView's "Waiting for body
 * telemetry…" empty state DOES fire. The "Unknown body"/"No atmospheric
 * model registered" notices still correctly stay absent on the station
 * (they require a DEFINED-but-unregistered body name, not an absent one),
 * so those two checks are safe on both screens.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — AtmosphereProfile", () => {
  test("panel title renders on host and station; happy-path state on host", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "atmosphere-profile", {
      waitForMain: async (page) => {
        await expect(
          page.getByText("ATMOSPHERE PROFILE", { exact: true }),
        ).toBeVisible({ timeout: 30_000 });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(
        page.getByText("ATMOSPHERE PROFILE", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText(/No atmospheric model registered/),
      ).toHaveCount(0);
      await expect(page.getByText(/Unknown body/)).toHaveCount(0);
    }

    await expect(
      pair.main.getByText("Waiting for body telemetry…", { exact: true }),
    ).toHaveCount(0);

    await teardownPair(pair);
  });
});
