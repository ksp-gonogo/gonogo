/**
 * Widget DOM mirror: LandingStatus. Asserts the panel header and the
 * "no landing in progress" notice on host and station.
 *
 * The fixture (`sitrep-stream-server.mjs`) has the vessel in a stable
 * Kerbin orbit:
 *   vessel.identity.situation   = Situation.Orbiting
 *   vessel.flight.verticalSpeed = +39.3   (ascending)
 *
 * A positive vertical speed means the craft is not falling, so the
 * suicide-burn solve returns `not-descending` and, with the craft not
 * landed, the panel gives its whole body over to the "No landing in
 * progress" notice (`Panel`'s `inactive`), with the header kept. An absent
 * vertical speed takes the same branch, so this text renders identically
 * with or without live data and is safe to check on both screens. The body
 * line ("Kerbin · atmospheric") belongs to the descent board the notice
 * replaces, so it is not drawn here.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror: LandingStatus", () => {
  test("orbit-state idle notice mirrors across host and station", async ({
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
    ).toHaveCount(0);

    await teardownPair(pair);
  });
});
