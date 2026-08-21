import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import cruise from "./__fixtures__/cruise-nominal.json";
import engineOverheat from "./__fixtures__/engine-overheat.json";
import noData from "./__fixtures__/no-thermal-data.json";
import reentryCritical from "./__fixtures__/reentry-critical.json";
import reentryWarning from "./__fixtures__/reentry-warning.json";
import solar from "./__fixtures__/solar-heating.json";
import { ThermalStatusComponent } from "./index";

/**
 * DOM snapshots off the stream pipeline, driven by each fixture's own
 * `_stream` block.
 *
 * This spec used to translate each fixture's flat `therm.*` keys into a
 * `vessel.thermal` emit by hand, on the reasoning that the shared harness
 * mounts no `TelemetryProvider` for a plain legacy fixture. It does for one
 * carrying a `_stream` block, and all six of these carry one saying the same
 * thing and a little more (`maxSkinTempRatio`, the part's internal temperatures
 * beside its skin ones), so the hand-built translation is gone and the fixture
 * is the single description of the scenario.
 */

const FIXTURES: Record<string, Record<string, unknown>> = {
  "cruise-nominal": cruise,
  "reentry-warning": reentryWarning,
  "reentry-critical": reentryCritical,
  "engine-overheat": engineOverheat,
  "solar-heating": solar,
  "no-thermal-data": noData,
};

const config = getWidget("thermal-status");
if (!config) throw new Error("thermal-status missing from widgets.ts");

describe("ThermalStatus DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: ThermalStatusComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
