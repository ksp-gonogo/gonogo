/**
 * Widget DOM mirror: DistanceToTarget. Asserts the panel title and the
 * no-target placeholder match on host and station.
 *
 * The replay feeds `vessel.target` as a literal `null` (see
 * `sitrep-stream-server.mjs`), which is the mod's own no-target convention: the
 * topic is declared `absenceIsData`, so a cleared target arrives as a TOMBSTONE.
 * The widget therefore renders the TARGET panel with the "No target set in KSP"
 * placeholder rather than a tracking readout, and PBDS mirrors the same value to
 * the station, so both sides read identically.
 *
 * This test is why the placeholder is DATED. `Reading<T>` splits "no frame yet"
 * from "the wire says there is nothing", and both used to render this same
 * string, so asserting the string alone could not tell you which reading
 * produced it. The caption assertion below is the part that can fail.
 *
 * An earlier version of this comment said the recording carried
 * "No Target Selected." in a name field and that the widget's job was to
 * recognise it. That was wrong: the string was Telemachus's sentinel for a null
 * target, `KspHost.BuildTarget` returns null before `name` is ever read, and the
 * client-side translator for it has been deleted. This test never exercised it.
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
