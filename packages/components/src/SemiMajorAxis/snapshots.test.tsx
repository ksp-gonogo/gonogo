import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import escapeKerbin from "./__fixtures__/escape-kerbin.json";
import jool from "./__fixtures__/jool-system.json";
import ksync from "./__fixtures__/ksync-kerbin.json";
import lko from "./__fixtures__/lko-kerbin.json";
import mun from "./__fixtures__/mun-orbit.json";
import noData from "./__fixtures__/no-data.json";
import { SemiMajorAxisComponent } from "./index";

/**
 * DOM snapshots off the stream pipeline, driven by each fixture's own
 * `_stream` block.
 *
 * This spec used to declare its five orbits inline as `{sma, ecc, bodyName}`
 * and build the stream around them. The five fixtures next door say the same
 * thing, are what the playwright probe renders, and additionally carry the
 * `vessel.identity` that resolves the reference body, so the inline copy is
 * gone.
 *
 * The sparkline is size-gated, and the hand-built render never installed a
 * `ResizeObserver` that reports one; the shared harness does, at the mode's own
 * pixel box.
 *
 * `no-data` carries no `_stream` block: no orbit to report is its subject, and
 * the un-fed gate lists it as empty by design.
 */

const FIXTURES: Record<string, Record<string, unknown>> = {
  "lko-kerbin": lko,
  "ksync-kerbin": ksync,
  "escape-kerbin": escapeKerbin,
  "mun-orbit": mun,
  "jool-system": jool,
  "no-data": noData,
};

const config = getWidget("semi-major-axis");
if (!config) throw new Error("semi-major-axis missing from widgets.ts");

describe("SemiMajorAxis DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: SemiMajorAxisComponent,
          fixture,
          mode,
          instanceId: "sma-snap",
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
