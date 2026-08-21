import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import duna from "./__fixtures__/duna-thin-atmosphere.json";
import eve from "./__fixtures__/eve-thick-atmosphere.json";
import reentry from "./__fixtures__/kerbin-reentry.json";
import seaLevel from "./__fixtures__/kerbin-sea-level.json";
import upper from "./__fixtures__/kerbin-upper-atmosphere.json";
import mun from "./__fixtures__/mun-vacuum.json";
import { AtmosphereProfileComponent } from "./index";

/**
 * DOM snapshots off the stream pipeline, driven by each fixture's own
 * `_stream` block.
 *
 * This spec used to hand-build that stream: it declared its own
 * `carriedChannels`, reshaped `v.body`/`v.altitude`/`v.atmosphericDensity`/
 * `v.atmosphericTemperature`/`v.externalTemperature` onto `vessel.flight` and a
 * single-entry `system.bodies`, and emitted them itself, on the reasoning that
 * the shared harness could not drive a widget whose reads are all native. All
 * six fixtures already carried a `_stream` block saying the same thing and
 * more, and the shared harness reads it now, so the hand-built copy is gone.
 *
 * It is worth saying what the hand-built copy cost, because it is the reason
 * `unfed-snapshot-debt.ts` existed: all 48 of these baselines were the string
 * "ATMOSPHERE PROFILE Waiting for body telemetry...", six atmospheres rendering
 * one blank. Two of the three causes were in the eleven lines this file no
 * longer has.
 */

const FIXTURES: Record<string, Record<string, unknown>> = {
  "kerbin-sea-level": seaLevel,
  "kerbin-upper-atmosphere": upper,
  "kerbin-reentry": reentry,
  "eve-thick-atmosphere": eve,
  "duna-thin-atmosphere": duna,
  "mun-vacuum": mun,
};

const config = getWidget("atmosphere-profile");
if (!config) throw new Error("atmosphere-profile missing from widgets.ts");

describe("AtmosphereProfile DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: AtmosphereProfileComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
