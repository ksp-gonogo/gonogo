import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import duna from "./__fixtures__/duna-thin-atmosphere.json";
import earth from "./__fixtures__/earth-rss-reentry.json";
import eve from "./__fixtures__/eve-thick-atmosphere.json";
import reentry from "./__fixtures__/kerbin-reentry.json";
import seaLevel from "./__fixtures__/kerbin-sea-level.json";
import upper from "./__fixtures__/kerbin-upper-atmosphere.json";
import mun from "./__fixtures__/mun-vacuum.json";
import { AtmosphereProfileComponent } from "./index";

/** DOM snapshots off the stream pipeline, driven by each fixture's own `_stream` block. */

const FIXTURES: Record<string, Record<string, unknown>> = {
  "kerbin-sea-level": seaLevel,
  "kerbin-upper-atmosphere": upper,
  "kerbin-reentry": reentry,
  "eve-thick-atmosphere": eve,
  "duna-thin-atmosphere": duna,
  "mun-vacuum": mun,
  "earth-rss-reentry": earth,
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
