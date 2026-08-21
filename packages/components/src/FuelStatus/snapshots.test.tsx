import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import ascentDrained from "./__fixtures__/ascent-stage-drained.json";
import asparagus from "./__fixtures__/asparagus-multi-stage.json";
import emptyOx from "./__fixtures__/empty-ox-mid-burn.json";
import lander from "./__fixtures__/lander-monoprop-only.json";
import launchpad from "./__fixtures__/launchpad-full-tanks.json";
import noEngine from "./__fixtures__/no-engine-data.json";
import { FuelStatusComponent } from "./index";

/**
 * DOM snapshots off the stream pipeline, driven by each fixture's own
 * `_stream` block.
 *
 * This spec used to build the stream itself, emitting `vessel.resources`,
 * `vessel.structure`, `dv.stages` and `dv.summary` reassembled from the
 * fixtures' flat keys. All four are declared by every fixture.
 *
 * The registered `defaultConfig` (`deltaVMode: "actual"`) now applies; the
 * hand-built render passed only the per-mode config, so which dV column the
 * widget was reading was whatever its own internal fallback happened to be.
 */

const FIXTURES: Record<string, Record<string, unknown>> = {
  "launchpad-full-tanks": launchpad,
  "ascent-stage-drained": ascentDrained,
  "asparagus-multi-stage": asparagus,
  "lander-monoprop-only": lander,
  "empty-ox-mid-burn": emptyOx,
  "no-engine-data": noEngine,
};

const config = getWidget("fuel-status");
if (!config) throw new Error("fuel-status missing from widgets.ts");

describe("FuelStatus DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: FuelStatusComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
