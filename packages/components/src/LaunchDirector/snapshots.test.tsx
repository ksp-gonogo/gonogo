import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import awaiting from "./__fixtures__/awaiting.json";
import inFlightAscent from "./__fixtures__/in-flight-ascent.json";
import inFlightCrash from "./__fixtures__/in-flight-crash.json";
import padOccupied from "./__fixtures__/pad-occupied.json";
import preLaunchInsufficient from "./__fixtures__/pre-launch-insufficient-funds.json";
import preLaunchMixed from "./__fixtures__/pre-launch-mixed.json";
import { LaunchDirectorComponent } from "./index";

const FIXTURES = {
  awaiting,
  "pre-launch-mixed": preLaunchMixed,
  "pre-launch-insufficient-funds": preLaunchInsufficient,
  "pad-occupied": padOccupied,
  "in-flight-ascent": inFlightAscent,
  "in-flight-crash": inFlightCrash,
};

const config = getWidget("launch-director");
if (!config) throw new Error("launch-director missing from widgets.ts");

describe("LaunchDirector DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: LaunchDirectorComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
