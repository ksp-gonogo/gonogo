import { PerfBudget } from "@ksp-gonogo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import finalApproach from "./__fixtures__/final-approach-mun.json";
import highSpeed from "./__fixtures__/high-speed-no-solution.json";
import reentry from "./__fixtures__/kerbin-reentry-atmospheric.json";
import landed from "./__fixtures__/landed-mun.json";
import preBurn from "./__fixtures__/pre-burn-cruise.json";
import suicideBurn from "./__fixtures__/suicide-burn-approaching.json";
import { LandingStatusComponent } from "./index";

/**
 * DOM snapshots off the stream pipeline, driven by each fixture's own
 * `_stream` block.
 *
 * This spec used to declare its six descents inline as `{body, descent,
 * availableThrust, oneWaySeconds, totalDvActual}` and replay them through a
 * stream it built. The six fixtures next door describe the same six scenarios,
 * are what the playwright probe renders, and carry one channel the inline
 * version had no way to express: `vessel.landing`, the whole predicted-site
 * payload (touchdown lat/lon, terrain elevation, slope). None of the 24
 * committed baselines contained any of it, so the landing board's own subject
 * was the part these snapshots did not cover.
 */

const FIXTURES: Record<string, Record<string, unknown>> = {
  "pre-burn-cruise": preBurn,
  "suicide-burn-approaching": suicideBurn,
  "final-approach-mun": finalApproach,
  "landed-mun": landed,
  "kerbin-reentry-atmospheric": reentry,
  "high-speed-no-solution": highSpeed,
};

const config = getWidget("landing-status/descent-gif");
if (!config)
  throw new Error("landing-status/descent-gif missing from widgets.ts");

describe("LandingStatus DOM snapshots", () => {
  /**
   * The contribution budgets, reset between tests as the three sibling specs do,
   * so a previous test's burst is not read as this one's.
   *
   * NOT reset at the end of the test, which would zero the gate's own diff and
   * is the shape this file briefly carried. `Contributions "<slot>" entries
   * recomputed/sec` is capped at 30 and reads 31 here on a fast laptop, which
   * looks like the compressed replay clock and was argued as one. It is not: on
   * an idle CI runner the same slots read 47 to 60, `widgets.axe.test.tsx` trips
   * them on this widget too, and two of these renders do not settle inside the
   * 30s test budget at all. The budget is describing the widget, so it keeps its
   * voice here.
   */
  beforeEach(() => {
    for (const b of PerfBudget.getAll()) {
      if (b.name.startsWith('Contributions "')) b.reset();
    }
  });

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
