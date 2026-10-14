import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import circular from "./__fixtures__/circular-lko.json";
import eccentric from "./__fixtures__/eccentric-capture.json";
import escapeTrajectory from "./__fixtures__/escape-trajectory.json";
import polar from "./__fixtures__/polar-orbit.json";
import retrograde from "./__fixtures__/retrograde-orbit.json";
import subOrbital from "./__fixtures__/sub-orbital.json";
import { CurrentOrbitComponent } from "./index";

/**
 * DOM snapshots driven by each fixture's own `_stream` block.
 * `vessel.orbit.horizon` is not nullable on the wire, so every fixture states one.
 */

const FIXTURES: Record<string, Record<string, unknown>> = {
  "circular-lko": circular,
  "eccentric-capture": eccentric,
  "escape-trajectory": escapeTrajectory,
  "polar-orbit": polar,
  "retrograde-orbit": retrograde,
  "sub-orbital": subOrbital,
};

const config = getWidget("current-orbit");
if (!config) throw new Error("current-orbit missing from widgets.ts");

describe("CurrentOrbit DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: CurrentOrbitComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
