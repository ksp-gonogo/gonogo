import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ActionGroupComponent } from "./index";

afterEach(() => clearActionHandlers());

const GROUPS = Array.from({ length: 10 }, (_, i) => ({
  index: i + 1,
  name: `AG${i + 1}`,
  state: false,
}));

describe("ActionGroup: a toggle sent over a delayed link", () => {
  it("shows the command as pending on the rail while the shown state is still the old one", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 1000, suspendFrames: true });
    fixture.transport.holdCommands();
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ag-light" }}>
          <ActionGroupComponent
            config={{ actionGroupId: "Light" }}
            id="ag-light"
            w={6}
            h={6}
          />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("comms.delay", { oneWaySeconds: 286, source: 1 });
      fixture.emit("vessel.control", {
        sas: false,
        sasMode: 0,
        rcs: false,
        gear: false,
        brakes: false,
        lights: true,
        throttle: 0,
        actionGroups: GROUPS,
      });
    });
    await screen.findByText("ON");

    act(() => {
      screen.getByRole("button", { name: "Toggle Light" }).click();
    });
    const [sent] = fixture.transport.sentCommands;
    act(() => {
      fixture.emit("system.uplink.pending", {
        pending: [
          {
            id: "engine-1",
            clientRequestId: sent.requestId,
            command: "vessel.control.setLights",
            label: "Toggle Light",
            topic: "",
            vantage: "ground:Kerbin: KSC",
            dispatchedAt: 1000,
            oneWaySeconds: 286,
          },
        ],
      });
    });

    expect(
      screen.getByRole("button", { name: "Toggle Light" }).textContent,
    ).toBe("ON · sent");
  });
});
