import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import earlyGame from "./__fixtures__/early-game-t1.json";
import flightScene from "./__fixtures__/flight-scene-upgrades-disabled.json";
import fullyUpgraded from "./__fixtures__/fully-upgraded-t3.json";
import lowFunds from "./__fixtures__/low-funds-expensive-upgrade.json";
import midCareer from "./__fixtures__/mid-career-mixed.json";
import sandbox from "./__fixtures__/sandbox-no-career.json";
import { SpaceCenterStatusComponent } from "./index";

/**
 * DOM snapshots off the stream pipeline, driven by each fixture's own
 * `_stream` block.
 *
 * This spec used to build the stream itself, emitting `career.status`,
 * `spaceCenter.scene` and `spaceCenter.launchSites` reassembled from the
 * fixtures' flat keys. Every fixture declares them, so the reassembly is gone.
 *
 * These are the 48 baselines whose every facility level was an em dash, the
 * second half of the pair that put `unfed-snapshot-gate.ts` there. That
 * particular cause (a settle-check waiting on a badge the bare harness never
 * renders) was fixed in place; reading the fixture's own wire is what stops the
 * spec and the probe describing one scenario two ways.
 */

const FIXTURES: Record<string, Record<string, unknown>> = {
  "early-game-t1": earlyGame,
  "mid-career-mixed": midCareer,
  "fully-upgraded-t3": fullyUpgraded,
  "sandbox-no-career": sandbox,
  "low-funds-expensive-upgrade": lowFunds,
  "flight-scene-upgrades-disabled": flightScene,
};

const config = getWidget("space-center-status");
if (!config) throw new Error("space-center-status missing from widgets.ts");

describe("SpaceCenterStatus DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: SpaceCenterStatusComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
