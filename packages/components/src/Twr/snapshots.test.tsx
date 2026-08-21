import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import atmosphereAscent from "./__fixtures__/atmosphere-ascent-ok.json";
import engineOff from "./__fixtures__/engine-off-empty.json";
import heavy from "./__fixtures__/heavy-lifter-warn.json";
import pinned from "./__fixtures__/pinned-high.json";
import standard from "./__fixtures__/standard-launch-ok.json";
import vacuumLow from "./__fixtures__/vacuum-low-nogo.json";
import { TwrComponent } from "./index";

/**
 * DOM snapshots off the stream pipeline, driven by each fixture's own
 * `_stream` block.
 *
 * This spec used to build the stream itself, emitting `vessel.propulsion` and
 * `vessel.orbit` reassembled from the fixtures' flat keys so the derived
 * `vessel.state.twr` would resolve. Both emits are declared by the fixtures.
 */

const FIXTURES: Record<string, Record<string, unknown>> = {
  "standard-launch-ok": standard,
  "atmosphere-ascent-ok": atmosphereAscent,
  "heavy-lifter-warn": heavy,
  "vacuum-low-nogo": vacuumLow,
  "pinned-high": pinned,
  "engine-off-empty": engineOff,
};

const config = getWidget("twr");
if (!config) throw new Error("twr missing from widgets.ts");

describe("Twr DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: TwrComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
