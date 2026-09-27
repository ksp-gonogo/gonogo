/**
 * Widget DOM mirror: Targeting. Asserts the panel title and the
 * no-target placeholder match on host and station.
 *
 * The replay feeds `vessel.target` as a literal `null` (see
 * `sitrep-stream-server.mjs`), the mod's own no-target convention: the topic is
 * declared `absenceIsData`, so a cleared target arrives as a TOMBSTONE and the
 * widget renders "No target set in KSP". A reading with no frame yet renders
 * "Waiting for target telemetry" instead, so asserting one and not the other
 * says which reading produced the placeholder.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror: Targeting", () => {
  test("no-target placeholder mirrors across host and station", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "targeting", {
      waitForMain: async (page) => {
        await expect(page.getByText("TARGET", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(page.getByText("TARGET", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByText("No target set in KSP", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Waiting for target telemetry")).toHaveCount(
        0,
      );
    }

    await teardownPair(pair);
  });
});
