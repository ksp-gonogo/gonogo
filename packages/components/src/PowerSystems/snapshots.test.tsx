import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import fullBattery from "./__fixtures__/01-full-battery-launch.json";
import draining from "./__fixtures__/02-battery-draining-high-load.json";
import charging from "./__fixtures__/03-solar-charging-sunlight.json";
import darkSide from "./__fixtures__/04-dark-side-drain.json";
import nearZero from "./__fixtures__/05-near-zero-battery-alarm.json";
import rtg from "./__fixtures__/06-rtg-steady-state.json";
import { PowerSystemsComponent } from "./index";

const FIXTURES = {
  "01-full-battery-launch": fullBattery,
  "02-battery-draining-high-load": draining,
  "03-solar-charging-sunlight": charging,
  "04-dark-side-drain": darkSide,
  "05-near-zero-battery-alarm": nearZero,
  "06-rtg-steady-state": rtg,
};

const config = getWidget("power-systems");
if (!config) throw new Error("power-systems missing from widgets.ts");

describe("PowerSystems DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: PowerSystemsComponent,
          fixture,
          mode,
          // PowerSystems uses useDataStreamStatus — connect the raw
          // MockDataSource so the rendered status
          // badge reflects "connected, streaming" rather than the shared
          // harness's opt-out-by-default "disconnected" convention (see
          // setupMockDataSource.ts's connectSource doc comment, and
          // FuelStatus/snapshots.test.tsx for the precedent).
          connectSource: true,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
