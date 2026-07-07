import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import deepSpace from "./__fixtures__/deep-space-delay.json";
import noSignalData from "./__fixtures__/no-signal-data.json";
import noSignalOccluded from "./__fixtures__/no-signal-occluded.json";
import relay from "./__fixtures__/relay-probe-network.json";
import strong from "./__fixtures__/strong-direct-ksc.json";
import weak from "./__fixtures__/weak-fading-occlusion.json";
import { CommSignalComponent } from "./index";

const FIXTURES = {
  "strong-direct-ksc": strong,
  "weak-fading-occlusion": weak,
  "no-signal-occluded": noSignalOccluded,
  "relay-probe-network": relay,
  "deep-space-delay": deepSpace,
  "no-signal-data": noSignalData,
};

const config = getWidget("comm-signal");
if (!config) throw new Error("comm-signal missing from widgets.ts");

describe("CommSignal DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: CommSignalComponent,
          fixture,
          mode,
          // CommSignal now adopts useDataStreamStatus (M3 batch 2) — connect
          // the raw MockDataSource so its rendered status badge reflects the
          // realistic "connected, streaming" scenario every one of these
          // fixtures actually depicts (see ThermalStatus/snapshots.test.tsx,
          // the batch-1 precedent).
          connectSource: true,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
