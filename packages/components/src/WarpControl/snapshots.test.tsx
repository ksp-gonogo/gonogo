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

/**
 * DOM snapshots off the stream pipeline, driven by each fixture's own
 * `_stream` block.
 *
 * This spec used to build that stream itself: it carried `spaceCenter.scene`
 * alone and re-derived a `time.warp` payload from the fixture's flat `t.*`
 * keys, mapping the warp-mode string back onto its enum ordinal in the test.
 * Each fixture already declares both channels on the wire, plus the
 * `spaceCenter.launchSites` and `career.mode` the pad-occupancy and career
 * readouts need and the hand-built stream carried neither of.
 *
 * `connectSource` stays on: the widget's status badge reads
 * `useDataStreamStatus("data", …)`, and a disconnected legacy source paints a
 * badge these fixtures do not depict.
 */

const FIXTURES: Record<string, Record<string, unknown>> = {
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
          connectSource: true,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
