import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import approach from "./__fixtures__/approach-closing.json";
import body from "./__fixtures__/celestial-body-tracking.json";
import aligned from "./__fixtures__/docking-aligned.json";
import misaligned from "./__fixtures__/docking-misaligned.json";
import far from "./__fixtures__/far-approach-vessel.json";
import noTarget from "./__fixtures__/no-target.json";
import { DistanceToTargetComponent } from "./index";

const FIXTURES = {
  "no-target": noTarget,
  "far-approach-vessel": far,
  "celestial-body-tracking": body,
  "approach-closing": approach,
  "docking-aligned": aligned,
  "docking-misaligned": misaligned,
};

const config = getWidget("distance-to-target");
if (!config) throw new Error("distance-to-target missing from widgets.ts");

describe("DistanceToTarget DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: DistanceToTargetComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
