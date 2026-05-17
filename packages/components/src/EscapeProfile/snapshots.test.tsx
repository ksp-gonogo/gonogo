import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import eve from "./__fixtures__/eve-orbit-high-gravity.json";
import escapeTraj from "./__fixtures__/kerbin-escape-trajectory.json";
import hko from "./__fixtures__/kerbin-hko-approaching-escape.json";
import lko from "./__fixtures__/kerbin-lko-well-below-escape.json";
import mun from "./__fixtures__/mun-surface-low-orbit.json";
import unknown from "./__fixtures__/unknown-body-no-reference.json";
import { EscapeProfileComponent } from "./index";

const FIXTURES = {
  "kerbin-lko-well-below-escape": lko,
  "kerbin-hko-approaching-escape": hko,
  "kerbin-escape-trajectory": escapeTraj,
  "mun-surface-low-orbit": mun,
  "eve-orbit-high-gravity": eve,
  "unknown-body-no-reference": unknown,
};

const config = getWidget("escape-profile");
if (!config) throw new Error("escape-profile missing from widgets.ts");

describe("EscapeProfile DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: EscapeProfileComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
