import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import draining from "./__fixtures__/battery-draining-high-load.json";
import darkSide from "./__fixtures__/dark-side-drain.json";
import fullBattery from "./__fixtures__/full-battery-launch.json";
import nearZero from "./__fixtures__/near-zero-battery-alarm.json";
import rtg from "./__fixtures__/rtg-steady-state.json";
import charging from "./__fixtures__/solar-charging-sunlight.json";
import { PowerSystemsComponent } from "./index";

const FIXTURES = {
  "full-battery-launch": fullBattery,
  "battery-draining-high-load": draining,
  "solar-charging-sunlight": charging,
  "dark-side-drain": darkSide,
  "near-zero-battery-alarm": nearZero,
  "rtg-steady-state": rtg,
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
          // Connected, so the status badge reflects a streaming source rather than the harness's disconnected default.
          connectSource: true,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
