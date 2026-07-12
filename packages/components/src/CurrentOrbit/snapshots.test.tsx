import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import circularLko from "./__fixtures__/circular-lko.json";
import eccentricCapture from "./__fixtures__/eccentric-capture.json";
import escapeTraj from "./__fixtures__/escape-trajectory.json";
import polar from "./__fixtures__/polar-orbit.json";
import retrograde from "./__fixtures__/retrograde-orbit.json";
import subOrbital from "./__fixtures__/sub-orbital.json";
import { CurrentOrbitComponent } from "./index";

const FIXTURES = {
  "circular-lko": circularLko,
  "eccentric-capture": eccentricCapture,
  "escape-trajectory": escapeTraj,
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
          // CurrentOrbit uses useDataStreamStatus — connect the raw
          // MockDataSource so its rendered status badge reflects the
          // realistic "connected, streaming" scenario every one of these
          // fixtures actually depicts (see
          // ThermalStatus/snapshots.test.tsx for the same pattern).
          connectSource: true,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
