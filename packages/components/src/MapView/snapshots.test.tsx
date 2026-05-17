import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import launchpad from "./__fixtures__/kerbin-launchpad.json";
import lko from "./__fixtures__/kerbin-lko-equator.json";
import reentry from "./__fixtures__/kerbin-reentry.json";
import mun from "./__fixtures__/mun-polar-orbit.json";
import noVessel from "./__fixtures__/no-vessel-data.json";
import { MapViewComponent } from "./index";

const FIXTURES = {
  "kerbin-launchpad": launchpad,
  "kerbin-lko-equator": lko,
  "kerbin-reentry": reentry,
  "mun-polar-orbit": mun,
  "no-vessel-data": noVessel,
};

const config = getWidget("map-view");
if (!config) throw new Error("map-view missing from widgets.ts");

describe("MapView DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: MapViewComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
