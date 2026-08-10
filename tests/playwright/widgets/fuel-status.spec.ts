/**
 * Widget DOM mirror: FuelStatus. Asserts the REAL ΔV totals, resource
 * bars, and per-stage stack on the host, and that the panel chrome mirrors
 * on the station.
 *
 * Runs against the TOPOLOGY fixture variant (`sitrep-stream-server-
 * topology.mjs`, a SEPARATE server/port from the shared snapshot; see
 * `bootstrapPair`'s `sitrepPort` option), which carries `dv.stages` /
 * `dv.summary` / `vessel.structure` on top of the shared snapshot. The
 * shared, deliberately dv-less fixture (`sitrep-stream-server.mjs`) is
 * UNTOUCHED: no other spec is affected.
 *
 * Fixture craft (topology server): the same "Mun Tester" vessel, currently
 * on its single propulsive stage (stage 1 of 2, stage 0 is the final
 * pod+chute stage, no engine):
 *   dv.summary: totalDvActual 1310.8 m/s, totalBurnTime 210.4s ("3min 30s")
 *   dv.stages[stage 1]: deltaVActual 1310.8, TWRActual 1.4321, burnTime
 *     210.4s, resources.LiquidFuel/Oxidizer matching the shared snapshot's
 *     `vessel.resources` totals (539.8/1980, 659.8/2420): the
 *     `dv.currentStageResource(Max)` derived channels resolve those into
 *     the "current" (stage-scoped) LiquidFuel/Oxidizer resource rows.
 *   dv.stages[stage 0]: all-zero (no engine left in that stage).
 *
 * Widget stays at 8×14 (its own defaultSize, same footprint the old
 * title-only spec already used): wide/tall enough for the totals row,
 * resource list, AND stage stack to all render.
 *
 * Station-side scope: only the "FUEL · ΔV" panel title (static chrome) is
 * checked on the station: real values come from live Sitrep stream data,
 * and only the MAIN screen mounts `SitrepTelemetryProvider` today (station
 * stream forwarding over PeerJS is a documented pending gap). Same pattern
 * as crew-manifest.spec.ts.
 */
import { test } from "@playwright/test";
import { PORTS } from "../../../playwright.config";
import {
  bootstrapPair,
  expect,
  expectVisibleText,
  teardownPair,
} from "../helpers";

test.describe("widget DOM mirror: FuelStatus", () => {
  test("real ΔV/resource data renders on host; panel chrome mirrors on station", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "fuel-status", {
      sitrepPort: PORTS.sitrepReplayTopology,
      widget: { size: { w: 8, h: 14 } },
      waitForMain: async (page) => {
        await expect(page.getByText("FUEL · ΔV", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
        // Full data path reached: the subtitle only renders once
        // `vessel.structure.currentStage` has arrived.
        await expect(
          page.getByText("Stage 1 / 1", { exact: true }),
        ).toBeVisible({ timeout: 15_000 });
      },
    });

    // Totals row: total ΔV (current-atmosphere default) + total burn.
    // Scoped to the "Total ΔV" block (not just `pair.main`): the fixture's
    // single propulsive stage has the same ΔV as the vessel total, so the
    // per-stage stack row below also renders "1311 m/s" and an unscoped
    // getByText would match both.
    const totalDvBlock = pair.main
      .getByText("Total ΔV", { exact: true })
      .locator("xpath=..");
    await expect(totalDvBlock).toBeVisible();
    await expect(
      totalDvBlock.getByText("1311 m/s", { exact: true }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      pair.main.getByText("Total burn", { exact: true }),
    ).toBeVisible();
    // "3min 30s" is now its OWN text node in two places (the total and the
    // active stage's row), because <Countdown> splits it out of the longer
    // string the stage row used to be. An exact-text match resolves to both
    // and trips strict mode; what this line is for is that the total reads
    // 3min 30s, and the stage row has its own assertion below.
    await expectVisibleText(pair.main, "3min 30s");

    // Resource list: the stage-scoped LiquidFuel/Oxidizer rows now
    // resolve (previously always 0/0 with dv.stages absent), plus the
    // vessel-scope MonoPropellant/ElectricCharge rows from the shared
    // snapshot's vessel.resources.
    await expect(
      pair.main.getByText("539.8 / 1980.0", { exact: true }),
    ).toBeVisible();
    await expect(
      pair.main.getByText("659.8 / 2420.0", { exact: true }),
    ).toBeVisible();
    await expect(
      pair.main.getByText("9.80 / 10.00", { exact: true }),
    ).toBeVisible();
    await expect(
      pair.main.getByText("448.8 / 450.0", { exact: true }),
    ).toBeVisible();

    // Per-stage stack: two stages, the active one (S1) carrying the ΔV.
    await expect(pair.main.getByText(/Stages · ΔV \(ACT\)/)).toBeVisible();
    await expect(pair.main.getByText(/S1/)).toBeVisible();
    await expect(pair.main.getByText(/S0/)).toBeVisible();
    await expectVisibleText(pair.main, "3min 30s · TWR 1.43");
    await expectVisibleText(pair.main, "0s · TWR 0.00");

    // Station: chrome only (known station-telemetry gap, see module doc).
    for (const page of [pair.main, pair.station]) {
      await expect(page.getByText("FUEL · ΔV", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }

    await teardownPair(pair);
  });
});
