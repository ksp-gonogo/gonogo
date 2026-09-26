import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ContractManagerComponent } from "./index";

/** ContractManager running off a real stream pipeline via `StubTransport`, including `completedRecent`. */
afterEach(() => {
  clearActionHandlers();
});

describe("ContractManager: genuinely runs off the stream", () => {
  it("renders active + offered contracts derived from career.status.contracts", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "cm-stream" }}>
          <ContractManagerComponent id="cm-stream" w={6} h={8} />
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
              id: "8834021456123789",
              title: "Rescue Kerbal from orbit of Kerbin",
              agent: "Kerbin Space Agency Rescue Division",
              state: "Active",
              fundsAdvance: 5000,
              fundsCompletion: 25000,
              scienceCompletion: 15,
              reputationCompletion: 8,
              dateDeadline: 2500000,
              parameters: [
                {
                  title: "Rescue Buzz Kerman",
                  state: "Incomplete",
                  stateOrdinal: 0,
                },
                {
                  title: "Return to Kerbin",
                  state: "Incomplete",
                  stateOrdinal: 0,
                },
              ],
            },
          ],
          offered: [
            {
              id: "1122334455667788",
              title: "Test RT-10 solid fuel booster in flight",
              agent: "Kerbin Space Program",
              state: "Offered",
              fundsAdvance: 0,
              fundsCompletion: 8500,
              scienceCompletion: 5,
              reputationCompletion: 3,
              dateDeadline: 0,
              parameters: [],
            },
          ],
          completedRecent: [
            {
              id: "5566778899001122",
              title: "Test the Communotron 16 in orbit of Kerbin",
              agent: "Kerbin Space Program",
              state: "Completed",
              fundsAdvance: 0,
              fundsCompletion: 4000,
              scienceCompletion: 2,
              reputationCompletion: 1,
              dateDeadline: 0,
              parameters: [],
            },
          ],
        },
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() =>
      expect(
        screen.getByText("Rescue Kerbal from orbit of Kerbin"),
      ).toBeTruthy(),
    );
    expect(screen.getByText("Rescue Buzz Kerman")).toBeTruthy();
    expect(
      screen.getByText("Test RT-10 solid fuel booster in flight"),
    ).toBeTruthy();
    // The subtitle's recent count proves `completedRecent` routed off the stream too.
    expect(visibleText()).toMatch(/1 active · 1 offered · 1 recent/i);
  });
});
