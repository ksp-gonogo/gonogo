/**
 * Widget DOM mirror: LandingStatus. Asserts the panel header and the
 * no-landing-prediction state on host and station, and the body-name
 * subtitle on the host.
 *
 * The fixture (`sitrep-stream-server.mjs`) has the vessel in a stable
 * Kerbin orbit:
 *   vessel.identity.situation   = Situation.Orbiting
 *   vessel.flight.verticalSpeed = +39.3   (ascending)
 *
 * The board stands up front whenever a vessel is reporting. A craft that is
 * not falling has no landing prediction, so the widget says so, and it says
 * it the same on both screens. The "Kerbin · atmospheric" subtitle is gated
 * on `bodyName !== undefined`
 * (`packages/components/src/LandingStatus/index.tsx`); it is checked on the
 * host only.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror: LandingStatus", () => {
  test("an orbiting vessel shows the board with no landing prediction on host and station; subtitle on host", async ({
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
        page.getByText("NO LANDING PREDICTION", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
    }

    await expect(
      pair.main.getByText("Kerbin · atmospheric", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    await teardownPair(pair);
  });
});
