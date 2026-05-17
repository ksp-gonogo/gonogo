import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import maxWarp from "./__fixtures__/max-warp-100000x.json";
import paused from "./__fixtures__/paused-in-flight.json";
import physics from "./__fixtures__/physics-warp-4x-atmosphere.json";
import rails from "./__fixtures__/rails-warp-1000x.json";
import realtime from "./__fixtures__/realtime-1x.json";
import spaceCenter from "./__fixtures__/space-center-no-flight.json";
import { WarpControlComponent } from "./index";

const FIXTURES = {
  "realtime-1x": realtime,
  "physics-warp-4x-atmosphere": physics,
  "rails-warp-1000x": rails,
  "max-warp-100000x": maxWarp,
  "paused-in-flight": paused,
  "space-center-no-flight": spaceCenter,
};

const config = getWidget("warp-control");
if (!config) throw new Error("warp-control missing from widgets.ts");

describe("WarpControl DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: WarpControlComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
