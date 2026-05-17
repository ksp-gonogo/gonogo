import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import finalApproach from "./__fixtures__/final-approach-mun.json";
import highSpeed from "./__fixtures__/high-speed-no-solution.json";
import reentry from "./__fixtures__/kerbin-reentry-atmospheric.json";
import landed from "./__fixtures__/landed-mun.json";
import preBurn from "./__fixtures__/pre-burn-cruise.json";
import suicideBurn from "./__fixtures__/suicide-burn-approaching.json";
import { LandingStatusComponent } from "./index";

const FIXTURES = {
  "pre-burn-cruise": preBurn,
  "suicide-burn-approaching": suicideBurn,
  "final-approach-mun": finalApproach,
  "landed-mun": landed,
  "kerbin-reentry-atmospheric": reentry,
  "high-speed-no-solution": highSpeed,
};

const config = getWidget("landing-status");
if (!config) throw new Error("landing-status missing from widgets.ts");

describe("LandingStatus DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: LandingStatusComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
