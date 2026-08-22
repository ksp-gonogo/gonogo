/**
 * Widget DOM mirror: TargetPicker. Asserts the panel title mirrors across
 * host and station, and (on the host, which mounts the stream provider) the
 * available-target LIST renders from the fixture's `target.available` entries
 * while the selected-target summary stays on its no-target branch.
 *
 * Fixture snapshot (`sitrep-stream-server.mjs`):
 *   - target.available.entries = [{Mun, Body}, {Minmus, Body}]  (isCurrent:false)
 *   - vessel.target            = null  (nothing selected)
 *
 * So on the host the widget renders:
 *   - a collapsible "Bodies (2)" category section (TargetPicker uses
 *     disclosure `<button aria-expanded>` sections + a "Suggested" section,
 *     NOT a tablist: there is no `role="tab"` and no "Current" tab anywhere
 *     in the component; the pre-2026-07-26 assertions asserted a tab UI that
 *     never existed, which is why this test was `fixme`),
 *   - the Mun / Minmus rows (each also mirrored into "Suggested"), and
 *   - "No target set in KSP." for the selected-target summary, because
 *     `vessel.target` is null (adding the LIST does not select a target,
 *     the two are separate Topics, so Targeting's no-target branch is
 *     untouched).
 *
 * Station-side scope: only the "TARGET PICKER" title (static chrome) is
 * checked on the station: the list is live Sitrep data and only the MAIN
 * screen mounts `SitrepTelemetryProvider` today (station stream forwarding
 * over PeerJS is a documented pending gap). On the station the widget sits on
 * "Waiting for target list…", by design, not a bug.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror: TargetPicker", () => {
  test("title mirrors; available-target list + no-target summary render on host", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "target-picker", {
      waitForMain: async (page) => {
        await expect(
          page.getByText("TARGET PICKER", { exact: true }),
        ).toBeVisible({ timeout: 30_000 });
      },
    });

    // Static chrome: the panel title mirrors on both screens.
    for (const page of [pair.main, pair.station]) {
      await expect(
        page.getByText("TARGET PICKER", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
    }

    // Host (stream provider mounted): the list rendered from the two fixture
    // body entries. The "Bodies (2)" disclosure button is the real DOM the
    // component emits (a `<button aria-expanded>` whose accessible name is
    // "Bodies (2)": the ▸ chevron is aria-hidden); its presence + count of 2
    // proves `target.available` was carried and parsed.
    await expect(
      pair.main.getByRole("button", { name: /Bodies \(2\)/ }),
    ).toBeVisible({ timeout: 15_000 });
    // The waiting placeholder is gone once the list arrives.
    await expect(pair.main.getByText(/Waiting for target list/)).toHaveCount(0);
    // The two body entries render as rows (each also mirrored into the
    // "Suggested" section, so it appears more than once, assert at least one).
    await expect(
      pair.main.getByText("Mun", { exact: true }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      pair.main.getByText("Minmus", { exact: true }).first(),
    ).toBeVisible({ timeout: 15_000 });
    // No target is SELECTED (vessel.target = null), the selected-target
    // summary stays on its no-target branch even though the list is populated.
    await expect(
      pair.main.getByText("No target set in KSP.", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    await teardownPair(pair);
  });
});
