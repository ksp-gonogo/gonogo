import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import contractsOnly from "./__fixtures__/contracts-only.json";
import { ObjectivesComponent } from "./index";

/**
 * Objectives's stream render golden. This began life as a legacy-`DataSource`
 * ↔ stream byte-identical dual-run; `contracts.active` now comes off
 * `career.status.contracts.active` (read canonically via
 * `useTelemetry("career.status")`) with NO legacy fallback, so the legacy leg
 * is gone. What remains proves the widget renders the same contract state off
 * the real stream pipeline. `contracts.active` (consumed via the shared
 * `parseContracts`/`contractObjectives` from `../ContractManager`) is the
 * widget's only read.
 */
afterEach(() => {
  clearActionHandlers();
});

describe("Objectives — stream render golden (delay=0)", () => {
  it("renders contract-parameter objectives off the stream for the same contract state", async () => {
    const streamFixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "obj-dual" }}>
          <ObjectivesComponent id="obj-dual" w={5} h={8} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      const wireActive = contractsOnly["contracts.active"].map((c) => {
        const { agency, repCompletion, deadlineUt, ...rest } = c;
        return {
          ...rest,
          agent: agency,
          reputationCompletion: repCompletion,
          dateDeadline: deadlineUt,
        };
      });
      streamFixture.emit("career.status", {
        economy: null,
        facilities: null,
        contracts: { active: wireActive, offered: [] },
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() => {
      if (!container.textContent?.includes("Test LV-909: Flying over Kerbin")) {
        throw new Error("stream leg has not rendered objectives yet");
      }
    });
    expect(container.textContent).toContain("Test the LV-909 in flight");
  });
});
