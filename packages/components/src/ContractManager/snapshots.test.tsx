import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import activeMission from "./__fixtures__/active-mission-partial.json";
import allComplete from "./__fixtures__/all-complete-awaiting-recovery.json";
import awaiting from "./__fixtures__/awaiting-telemetry.json";
import mixedFailed from "./__fixtures__/mixed-failed-parameters.json";
import multipleActive from "./__fixtures__/multiple-active-contracts.json";
import noContracts from "./__fixtures__/no-contracts.json";
import { ContractManagerComponent } from "./index";

/**
 * DOM snapshots off the stream pipeline, driven by each fixture's own
 * `_stream` block.
 * Each fixture declares its own `career.status` emit and pinned UT.
 *
 * `awaiting-telemetry` carries no `_stream` block: the pre-telemetry
 * placeholder is its subject, and the un-fed gate lists it as empty by design.
 */

const FIXTURES: Record<string, Record<string, unknown>> = {
  "awaiting-telemetry": awaiting,
  "no-contracts": noContracts,
  "active-mission-partial": activeMission,
  "all-complete-awaiting-recovery": allComplete,
  "mixed-failed-parameters": mixedFailed,
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
