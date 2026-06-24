import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import servos from "./__fixtures__/servos.json";
import unavailable from "./__fixtures__/unavailable.json";
import { RoboticsConsoleComponent } from "./index";

const FIXTURES = {
  servos,
  unavailable,
};

const config = getWidget("robotics-console");
if (!config) throw new Error("robotics-console missing from widgets.ts");

describe("RoboticsConsole DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: RoboticsConsoleComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
