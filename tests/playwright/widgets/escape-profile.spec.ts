/**
 * Widget DOM mirror — EscapeProfile. Asserts the panel title renders on
 * both host and station, and that neither degraded-state notice fires.
 *
 * EscapeProfile is a pure chart widget — its data outputs (orbital-speed
 * trace vs altitude, plus the analytic escape-velocity reference curve)
 * are drawn into the LineChart SVG. There's no formatted readout in
 * normal DOM to assert on, so we lean on the panel title plus the
 * absence of the two degraded notices the widget surfaces when its
 * inputs are bad:
 *
 *   - "Unknown body …" when `v.body` resolves but isn't in the registry.
 *   - "No reference data for …" when the matched body has no `gm`.
 *
 * The recorded fixture's final snapshot has:
 *   v.body         = "Kerbin"
 *   o.sma          = 773862
 *   o.eccentricity = 0.0957
 *   o.ApA          = 247905
 *   o.PeA          = 99820
 *   o.period       = 2276
 *   v.altitude     = 100953
 *
 * Eccentricity < 1, so the vessel is in a closed orbit — no escape
 * trajectory, but the widget doesn't gate on that: it always plots the
 * trace against the escape-velocity reference curve. Kerbin is a stock
 * body with gm = 3.5316e12, so the widget takes the happy path on both
 * sides and neither notice should appear. The vessel-in-flight
 * RequiresGuard also passes (the replay surfaces the normal flight-scene
 * telemetry the guard sniffs).
 *
 * We assert title visibility on each side and confirm the notice
 * `role="status"` elements are absent — the same invariant on both
 * pages is what proves the host→station mirror is intact for this
 * widget's inputs.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — EscapeProfile", () => {
  test("panel title mirrors across host and station with no degraded notice", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "escape-profile", {
      waitForMain: async (page) => {
        await expect(
          page.getByText("ESCAPE PROFILE", { exact: true }),
        ).toBeVisible({ timeout: 30_000 });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(
        page.getByText("ESCAPE PROFILE", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      // Kerbin is a known body with gm defined → neither degraded
      // notice should render. Asserting their absence on both sides
      // proves v.body (and the body lookup) reached the station via
      // PBDS just like it did on the host.
      await expect(
        page.getByText(/Unknown body/, { exact: false }),
      ).toHaveCount(0);
      await expect(
        page.getByText(/No reference data for/, { exact: false }),
      ).toHaveCount(0);
    }

    await teardownPair(pair);
  });
});
