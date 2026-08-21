import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import launchpad from "./__fixtures__/kerbin-launchpad.json";
import lko from "./__fixtures__/kerbin-lko-equator.json";
import reentry from "./__fixtures__/kerbin-reentry.json";
import mun from "./__fixtures__/mun-polar-orbit.json";
import noVessel from "./__fixtures__/no-vessel-data.json";
import { MapViewComponent } from "./index";

/**
 * DOM snapshots off the stream pipeline, driven by each fixture's own
 * `_stream` block.
 *
 * This spec used to build the stream itself, emitting `vessel.flight`,
 * `vessel.orbit`, `vessel.identity` and `system.bodies` reassembled from the
 * fixtures' flat keys and pinning the clock at a constant 10 rather than each
 * fixture's own UT. Every fixture declares all four emits and its own
 * `pinnedUt`.
 *
 * The registered `defaultConfig` (`trajectoryLength: 2000`,
 * `showPrediction: true`) now applies, and the map canvas is size-gated, so the
 * mode's real pixel box reaches it instead of the no-op observer's silence.
 *
 * `no-vessel-data` carries no `_stream` block: no position to plot is its
 * subject, and the un-fed gate lists it as empty by design.
 */

const FIXTURES: Record<string, Record<string, unknown>> = {
  "kerbin-launchpad": launchpad,
  "kerbin-lko-equator": lko,
  "kerbin-reentry": reentry,
  "mun-polar-orbit": mun,
  "no-vessel-data": noVessel,
};

const config = getWidget("map-view");
if (!config) throw new Error("map-view missing from widgets.ts");

describe("MapView DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: MapViewComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
