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
   * The contribution budgets, reset between tests, for the reason the three
   * sibling specs already document.
   *
   * `Contributions "<slot>" entries recomputed/sec` is capped at 30, which is
   * ~7x a real 4 Hz stream. A spec replays its whole scenario in a handful of
   * milliseconds, so every frame lands inside one rolling second and each slot
   * trips the cap. The same frames take seconds in the app.
   *
   * Reset rather than raised: the threshold is right for the load it measures,
   * and widening it to fit a test's clock is how a budget stops being able to
   * see the regression it exists for. This file was the only one of the four
   * without the reset, so it passed alone and failed under a loaded CI run.
   */
  beforeEach(() => {
    for (const b of PerfBudget.getAll()) b.reset();
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
