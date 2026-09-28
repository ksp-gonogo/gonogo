import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ObjectivesComponent } from "./index";

/** Proves Objectives runs off the real stream pipeline via `StubTransport`. */
afterEach(() => {
  clearActionHandlers();
});

describe("Objectives: genuinely runs off the stream (M3b career-detail batch)", () => {
  it("renders contract-parameter objectives derived from career.status.contracts.active", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "obj-stream" }}>
          <ObjectivesComponent id="obj-stream" w={5} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("career.status")).toBe(true);

    act(() => {
      fixture.emit("career.status", {
        economy: null,
        facilities: null,
        contracts: {
          active: [
            {
              id: "9001",
              title: "Test the LV-909 in flight",
              agent: "C7 Aerospace",
              state: "Active",
              fundsAdvance: 3000,
              fundsCompletion: 9000,
              scienceCompletion: 0,
              reputationCompletion: 2,
              dateDeadline: 0,
              parameters: [
                {
                  title: "Test LV-909: Flying over Kerbin",
                  state: "Incomplete",
                },
              ],
            },
          ],
          offered: [],
        },
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() =>
      expect(visibleText()).toContain("Test LV-909: Flying over Kerbin"),
    );
    expect(visibleText()).toContain("Test the LV-909 in flight");
  });
});
