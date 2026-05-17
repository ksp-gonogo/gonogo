import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import ag1 from "./__fixtures__/ag1-parachutes-armed.json";
import coldPad from "./__fixtures__/cold-pad-all-off.json";
import gearDown from "./__fixtures__/gear-down-landed.json";
import launchConfig from "./__fixtures__/launch-config-sas-on.json";
import noSignal from "./__fixtures__/no-signal-paused.json";
import unknown from "./__fixtures__/unknown-state.json";
import { ActionGroupComponent } from "./index";

const FIXTURES = {
  "cold-pad-all-off": coldPad,
  "launch-config-sas-on": launchConfig,
  "gear-down-landed": gearDown,
  "ag1-parachutes-armed": ag1,
  "no-signal-paused": noSignal,
  "unknown-state": unknown,
};

const config = getWidget("action-group");
if (!config) throw new Error("action-group missing from widgets.ts");

describe("ActionGroup DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: ActionGroupComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
