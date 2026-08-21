import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import contractsOnly from "./__fixtures__/contracts-only.json";
import empty from "./__fixtures__/empty.json";
import { ObjectivesComponent } from "./index";

/**
 * DOM snapshots off the stream pipeline, driven by each fixture's own
 * `_stream` block.
 *
 * This spec used to reach into each fixture for its `contracts.active` array
 * and rebuild a `career.status` emit around it; both fixtures declare that
 * emit already, so the reshape is gone and the whole fixture is passed through.
 */

const FIXTURES: Record<string, Record<string, unknown>> = {
  "contracts-only": contractsOnly,
  empty,
};

const config = getWidget("objectives");
if (!config) throw new Error("objectives missing from widgets.ts");

describe("Objectives DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: ObjectivesComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
