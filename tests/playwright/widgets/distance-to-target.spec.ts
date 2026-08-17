/**
 * Widget DOM mirror: DistanceToTarget. Asserts the panel title and the
 * no-target placeholder match on host and station.
 *
 * The recorded fixture's final snapshot has tar.name = "No Target Selected."
 * the KSP NO_TARGET_SENTINEL, which `resolveTargetName` maps to undefined.
 * So the widget takes its no-target branch and renders the TARGET panel with
 * the "No target set in KSP" placeholder (not a tracking readout). PBDS
 * mirrors the same value to the station, so both sides read identically.
 *
 * This test is why the sentinel is handled as a CONFIRMED absence rather than
 * as a pending read. `Reading<T>` split "no frame yet" from "the wire says
 * there is nothing", and the sentinel is a third encoding of the latter: the
 * record genuinely arrived, so the reading is `current`, and only the name
 * inside it says there is no target. Every unit test passed while the widget
 * called that pending; the recorded fixture, which carries what KSP actually
 * sends, did not. It also asserts the caption, because the placeholder alone
 * cannot distinguish the two readings that can produce it.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror: DistanceToTarget", () => {
  test("no-target placeholder mirrors across host and station", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "distance-to-target", {
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
      // `exact` still holds because the placeholder and its caption are
      // separate elements (stacked, not inline siblings of a bare text node):
      // running them together was how this read out as one string to a screen
      // reader.
      // The claim is dated. Without this the test passes just as happily on the
      // pending branch reworded, which is exactly the confusion the reading
      // type exists to end.
      await expect(page.getByText(/(confirmed|last seen) .* ago/)).toBeVisible({
        timeout: 15_000,
      });
    }

    await teardownPair(pair);
  });
});
