import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import atCap from "./__fixtures__/at-admin-cap.json";
import unavailable from "./__fixtures__/feature-unavailable.json";
import highCommit from "./__fixtures__/high-commitment-conversion.json";
import noStrategies from "./__fixtures__/no-strategies-early-career.json";
import oneActive from "./__fixtures__/one-active-room-for-more.json";
import overCap from "./__fixtures__/over-cap-quirk.json";
import { StrategiesComponent } from "./index";

const FIXTURES = {
  "no-strategies-early-career": noStrategies,
  "one-active-room-for-more": oneActive,
  "at-admin-cap": atCap,
  "over-cap-quirk": overCap,
  "high-commitment-conversion": highCommit,
  "feature-unavailable": unavailable,
};

const config = getWidget("strategies");
if (!config) throw new Error("strategies missing from widgets.ts");

describe("Strategies DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: StrategiesComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
