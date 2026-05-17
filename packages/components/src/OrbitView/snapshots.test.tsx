import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import eccentric from "./__fixtures__/eccentric-kerbin.json";
import escapeTraj from "./__fixtures__/escape-trajectory.json";
import lko from "./__fixtures__/lko-circular.json";
import mun from "./__fixtures__/mun-orbit.json";
import noData from "./__fixtures__/no-data.json";
import subOrbital from "./__fixtures__/sub-orbital-kerbin.json";
import { OrbitViewComponent } from "./index";

const FIXTURES = {
  "lko-circular": lko,
  "eccentric-kerbin": eccentric,
  "escape-trajectory": escapeTraj,
  "sub-orbital-kerbin": subOrbital,
  "mun-orbit": mun,
  "no-data": noData,
};

const config = getWidget("orbit-view");
if (!config) throw new Error("orbit-view missing from widgets.ts");

describe("OrbitView DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: OrbitViewComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
