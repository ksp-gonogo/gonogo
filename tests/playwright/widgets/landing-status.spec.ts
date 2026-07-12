/**
 * Widget DOM mirror — LandingStatus. Asserts the panel header and the
 * "no landing in progress" empty state on host and station, and the
 * body-name subtitle on the host.
 *
 * The fixture (`sitrep-stream-server.mjs`) has the vessel in a stable
 * Kerbin orbit:
 *   vessel.identity.situation   = Situation.Orbiting
 *   vessel.flight.verticalSpeed = +39.3   (ascending → `descending` is false)
 *   vessel.state.landingTimeToImpact = null (OnRails basis — landing
 *                                     scalars are measured-basis only)
 *
 * `notNumber(timeToImpact)` is true, so the widget short-circuits to the
 * EmptyState. Because vertical speed is non-negative the message is the
 * "No landing in progress" branch (not "Waiting for a landing
 * prediction…") — that branch only reads `descending` (`verticalSpeed !==
 * undefined && verticalSpeed < 0`), which is also `false` when
 * `verticalSpeed` is simply absent, so this text renders identically with
 * or without live data and is safe to check on both screens.
 *
 * The "Kerbin · atmospheric" subtitle is different: it's gated on
 * `bodyName !== undefined` (`packages/components/src/LandingStatus/index.tsx`),
 * and only the MAIN screen mounts `SitrepTelemetryProvider` today (station
 * stream forwarding over PeerJS is a documented pending gap, see that
 * provider's own doc comment) — so it's checked on the host only.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — LandingStatus", () => {
  test("orbit-state empty readout mirrors across host and station; subtitle on host", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "landing-status", {
      waitForMain: async (page) => {
        await expect(page.getByText("LANDING", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(page.getByText("LANDING", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByText("No landing in progress", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
    }

    await expect(
      pair.main.getByText("Kerbin · atmospheric", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    await teardownPair(pair);
  });
});
