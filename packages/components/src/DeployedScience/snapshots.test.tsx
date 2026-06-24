import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import bases from "./__fixtures__/bases.json";
import unavailable from "./__fixtures__/unavailable.json";
import { DeployedScienceComponent } from "./index";

const FIXTURES = {
  bases,
  unavailable,
};

const config = getWidget("deployed-science");
if (!config) throw new Error("deployed-science missing from widgets.ts");

describe("DeployedScience DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: DeployedScienceComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
