import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ContractManagerComponent } from "./index";

afterEach(() => {
  clearActionHandlers();
});

function mount() {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "cm-milestone" }}>
        <ContractManagerComponent id="cm-milestone" w={6} h={8} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("career.status", {
      balances: null,
      facilities: null,
      contracts: {
        active: [
          {
            id: "1",
            title: "Escape the atmosphere!",
            agent: "Kerbin Space Program",
            state: "Active",
            fundsAdvance: 11200,
            fundsCompletion: 20800,
            scienceCompletion: 4,
            reputationCompletion: 8,
            dateDeadline: 0,
            parameters: [
              {
                title: "Achieve goal",
                state: "Incomplete",
                stateOrdinal: 0,
                milestone: "REACHSPACE",
                milestoneBody: "Kerbin",
                targetAltitude: 70000,
              },
            ],
          },
        ],
        offered: [],
        completedRecent: [],
        failedRecent: [],
      },
    });
    fixture.emit("vessel.flight", { altitudeAsl: 12300 });
    fixture.store.beginFrame();
  });
  return fixture;
}

describe("ContractManager: a milestone objective's target and progress", () => {
  it("says what the goal is and where it is reached, with the vessel's altitude against it", () => {
    mount();

    const text = visibleText(document.body);
    expect(text).toContain("Achieve goal");
    expect(text).toContain("Reach space at Kerbin");
    expect(text).toMatch(/70(\.0)?\s*km/);
    expect(text).toMatch(/now 12\.3\s*km/);
  });
});
