import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import contractsOnly from "./__fixtures__/contracts-only.json";
import { ObjectivesComponent } from "./index";

/** Proves Objectives renders contract state off the real stream pipeline. */
afterEach(() => {
  clearActionHandlers();
});

describe("Objectives: stream render golden (delay=0)", () => {
  it("renders contract-parameter objectives off the stream for the same contract state", async () => {
    const streamFixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
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
        balances: null,
        facilities: null,
        contracts: { active: wireActive, offered: [] },
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() => {
      if (!visibleText(container).includes("Test LV-909: Flying over Kerbin")) {
        throw new Error("stream leg has not rendered objectives yet");
      }
    });
    expect(visibleText(container)).toContain("Test the LV-909 in flight");
  });
});
