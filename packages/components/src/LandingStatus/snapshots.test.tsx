import { PerfBudget } from "@ksp-gonogo/core";
import { afterEach, describe, expect, it } from "vitest";
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
   * The contribution budgets, reset at the END of each test, which is the
   * remedy `PerfBudget.installTestGate` itself prescribes for a spec whose
   * clock is compressed.
   *
   * `Contributions "<slot>" entries recomputed/sec` is capped at 30, ~7x a real
   * 4 Hz stream. Each fixture replays ten frames back-to-back, so its ~31
   * recomputes all land inside one wall second; the same ten frames take two
   * and a half seconds in the app and read as 12/sec. Resetting BEFORE the test
   * does not reach that, because the overflow happens within the single test
   * the gate is diffing across, which is why this file kept failing whenever it
   * had the machine to itself and passed under a loaded parallel run.
   *
   * Reset rather than raised: the threshold is right for the load it measures.
   * The live assertion is not lost, `index.test.tsx`, `stream.test.tsx` and
   * `undefined.characterise.test.tsx` drive the same slots at a rate the budget
   * still grades.
   */
  afterEach(() => {
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
