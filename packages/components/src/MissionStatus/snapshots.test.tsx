import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import fail from "./__fixtures__/fail.json";
import running from "./__fixtures__/running.json";
import success from "./__fixtures__/success.json";
import unavailable from "./__fixtures__/unavailable.json";
import { MissionStatusComponent } from "./index";

const FIXTURES = {
  running,
  success,
  fail,
  unavailable,
};

const config = getWidget("mission-status");
if (!config) throw new Error("mission-status missing from widgets.ts");

describe("MissionStatus DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: MissionStatusComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
