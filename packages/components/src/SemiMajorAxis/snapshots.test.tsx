/**
 * DOM-snapshot regression tests for the SemiMajorAxis widget.
 *
 * Catches structural drift (rendered text, element order, attribute
 * changes) across every fixture × mode combination registered for the
 * widget. The matching PNG renders live in
 * `local_docs/renders/semi-major-axis-widget/` and cover the visual
 * layer that DOM snapshots can't (styled-components CSS, fonts, etc).
 *
 * If the widget output intentionally changes, regenerate with
 * `pnpm --filter @gonogo/components exec vitest run src/SemiMajorAxis/snapshots -u`.
 */
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import escapeKerbin from "./__fixtures__/escape-kerbin.json";
import joolSystem from "./__fixtures__/jool-system.json";
import ksyncKerbin from "./__fixtures__/ksync-kerbin.json";
import lkoKerbin from "./__fixtures__/lko-kerbin.json";
import munOrbit from "./__fixtures__/mun-orbit.json";
import noData from "./__fixtures__/no-data.json";
import { SemiMajorAxisComponent } from "./index";

const FIXTURES = {
  "lko-kerbin": lkoKerbin,
  "ksync-kerbin": ksyncKerbin,
  "escape-kerbin": escapeKerbin,
  "mun-orbit": munOrbit,
  "jool-system": joolSystem,
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
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
