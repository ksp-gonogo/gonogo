import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import highEcc from "./__fixtures__/kerbin-high-eccentric.json";
import lko from "./__fixtures__/kerbin-lko.json";
import sync from "./__fixtures__/kerbin-synchronous.json";
import minmus from "./__fixtures__/minmus-orbit.json";
import mun from "./__fixtures__/mun-orbit.json";
import noBody from "./__fixtures__/no-body-data.json";
import { KeplerPeriodComponent } from "./index";

const FIXTURES = {
  "kerbin-lko": lko,
  "kerbin-synchronous": sync,
  "kerbin-high-eccentric": highEcc,
  "mun-orbit": mun,
  "minmus-orbit": minmus,
  "no-body-data": noBody,
};

const config = getWidget("kepler-period");
if (!config) throw new Error("kepler-period missing from widgets.ts");

describe("KeplerPeriod DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: KeplerPeriodComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
