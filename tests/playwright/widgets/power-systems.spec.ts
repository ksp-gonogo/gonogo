/**
 * Widget DOM mirror: PowerSystems. Asserts the REAL rendered topology
 * (per-part Producers/Consumers rows, NET/PROD/CONS/STORED totals) on the
 * host, and that the panel chrome mirrors on the station.
 *
 * Runs against the TOPOLOGY fixture variant (`sitrep-stream-server-
 * topology.mjs`, a SEPARATE server/port from the shared snapshot; see
 * `bootstrapPair`'s `sitrepPort` option), which carries `vessel.parts` on
 * top of the shared snapshot. The shared, deliberately-topology-less
 * fixture (`sitrep-stream-server.mjs`) is UNTOUCHED, no other spec's
 * "topology absent" assertion (nor this widget's OWN unit-test coverage of
 * that branch) is affected.
 *
 * Fixture craft (topology server): the same "Mun Tester" Kerbin-orbiting
 * probe the shared snapshot describes, with a small Mk1-pod stack, pod +
 * battery (EC storage, no flow) + two OX-4W solar panels (+4.20/s each) +
 * an HG-5 antenna (-0.17/s). So for the default ElectricCharge focus:
 *   PROD = +8.40   CONS = -0.17   NET = +8.23/s
 *   STORED = pod 48.802128027849/50 + battery 400/400 = 449 / 450
 * (formatUnits rounds to whole units above 100).
 *
 * Widget sized 8×12 (PowerSystems' own defaultSize) so the full
 * Producers/Consumers layout renders, the default 8×6 bootstrapPair
 * footprint is too short (`showFullList` needs rows >= 8).
 *
 * Station-side scope: only the "POWER SYSTEMS" panel title (static chrome,
 * rendered in EVERY branch of the widget including the pre-topology one) is
 * checked on the station: real values come from live Sitrep stream data,
 * and only the MAIN screen mounts `SitrepTelemetryProvider` today (station
 * stream forwarding over PeerJS is a documented pending gap). Same pattern
 * as crew-manifest.spec.ts.
 */
import { test } from "@playwright/test";
import { PORTS } from "../../../playwright.config";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror: PowerSystems", () => {
  test("real topology renders on host; panel chrome mirrors on station", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "power-systems", {
      sitrepPort: PORTS.sitrepReplayTopology,
      widget: { size: { w: 8, h: 12 } },
      waitForMain: async (page) => {
        await expect(
          page.getByText("POWER SYSTEMS", { exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        // Full data path reached (topology + live flow resolved), the
        // NET cell only renders once `resourcesWithFlow` is non-empty.
        await expect(page.getByText("NET", { exact: true })).toBeVisible({
          timeout: 15_000,
        });
      },
    });

    // No more "Waiting for vessel topology...": real data rendered.
    await expect(
      pair.main.getByText("Waiting for vessel topology...", { exact: true }),
    ).toHaveCount(0);

    // Totals row.
    await expect(pair.main.getByText("+8.23/s", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(pair.main.getByText("+8.40", { exact: true })).toBeVisible();
    await expect(
      pair.main.getByText("449 / 450", { exact: true }),
    ).toBeVisible();

    // Producers: two OX-4W panels, +4.20/s each, 100% of nominal.
    await expect(
      pair.main.getByText("OX-4W 2x3 Photovoltaic Panels", { exact: true }),
    ).toHaveCount(2);
    await expect(pair.main.getByText("+4.20", { exact: true })).toHaveCount(2);

    // Consumers: the HG-5 antenna, -0.17/s. Same literal string as the
    // CONS total cell, so two occurrences total.
    await expect(
      pair.main.getByText("HG-5 High Gain Antenna", { exact: true }),
    ).toBeVisible();
    await expect(pair.main.getByText("-0.17", { exact: true })).toHaveCount(2);

    // Station: chrome only (known station-telemetry gap, see module doc).
    await expect(
      pair.station.getByText("POWER SYSTEMS", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    await teardownPair(pair);
  });
});
