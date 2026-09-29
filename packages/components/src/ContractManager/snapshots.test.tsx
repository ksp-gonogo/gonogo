import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import activeMission from "./__fixtures__/active-mission-partial.json";
import awaiting from "./__fixtures__/awaiting-telemetry.json";
import expiredDeadline from "./__fixtures__/expired-deadline.json";
import multipleActive from "./__fixtures__/multiple-active-contracts.json";
import noContracts from "./__fixtures__/no-contracts.json";
import { ContractManagerComponent } from "./index";

/**
 * DOM snapshots off the stream pipeline, driven by each fixture's own `_stream`
 * block. `awaiting-telemetry` has none: the pre-telemetry placeholder is its
 * subject.
 */

const FIXTURES: Record<string, Record<string, unknown>> = {
  "awaiting-telemetry": awaiting,
  "no-contracts": noContracts,
  "active-mission-partial": activeMission,
  "expired-deadline": expiredDeadline,
  "multiple-active-contracts": multipleActive,
};

const config = getWidget("contract-manager");
if (!config) throw new Error("contract-manager missing from widgets.ts");

describe("ContractManager DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: ContractManagerComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
