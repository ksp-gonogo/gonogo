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

const FIXTURES = {
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
          // FuelStatus uses useDataStreamStatus — connect
          // the raw MockDataSource so its rendered status badge reflects the
          // realistic "connected, streaming" scenario every one of these
          // fixtures actually depicts, instead of the shared harness's
          // opt-out-by-default "disconnected" convention (see
          // setupMockDataSource.ts's connectSource doc comment, and
          // WarpControl/snapshots.test.tsx for the precedent).
          connectSource: true,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
