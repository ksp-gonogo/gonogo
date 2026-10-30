import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import noData from "./__fixtures__/no-data.json";
import { OrbitViewComponent } from "./index";

/**
 * The no-data fixture is the scene the visual gate draws for an orbit that has
 * not been received. A craft seated on a surface in it is drawn on the body
 * instead of the empty message, so the render stops showing the state it is for.
 */
const config = getWidget("orbit-view");
if (!config) throw new Error("orbit-view missing from widgets.ts");

describe("OrbitView no-data fixture", () => {
  for (const mode of config.modes) {
    it(`shows the empty message @ ${mode.name}`, async () => {
      const html = await snapshotWidgetMode({
        Widget: OrbitViewComponent,
        fixture: noData,
        mode,
        connectSource: true,
      });
      expect(html).toContain("No orbital data");
      expect(html).not.toContain("equator");
    });
  }
});
