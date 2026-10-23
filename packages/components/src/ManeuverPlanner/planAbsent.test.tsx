import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

function mount() {
  const fixture = setupStreamFixture({
    pinnedUt: 1_000_000,
    suspendFrames: true,
  });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "mnv-absent" }}>
        <ManeuverPlannerComponent id="mnv-absent" config={{}} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, ...view };
}

describe("ManeuverPlanner before the plan has arrived", () => {
  it("does not say there are no nodes or no burns while vessel.maneuver is absent", async () => {
    mount();
    await screen.findByRole("heading", { name: "Conformance" });
    expect(screen.queryByText("No maneuver nodes planned")).toBeNull();
    expect(screen.queryByText("No planned burns to compare")).toBeNull();
    expect(
      screen.getAllByText(/awaiting maneuver plan/i).length,
    ).toBeGreaterThan(0);
    await act(async () => {});
  });

  it("says there are none once an empty plan has arrived", async () => {
    const { fixture } = mount();
    await screen.findByRole("heading", { name: "Conformance" });
    act(() => {
      fixture.emit("vessel.maneuver", { nodes: [] });
    });
    await waitFor(() =>
      expect(
        screen.getByText("No planned burns to compare"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("No maneuver nodes planned")).toBeInTheDocument();
    expect(screen.queryByText(/awaiting maneuver plan/i)).toBeNull();
    await act(async () => {});
  });
});
