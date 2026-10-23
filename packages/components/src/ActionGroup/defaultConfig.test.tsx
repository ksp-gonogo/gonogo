import {
  clearActionHandlers,
  DashboardItemContext,
  getComponents,
} from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import type { ActionGroupConfig } from "./config";
import { ActionGroupComponent } from "./index";

afterEach(() => clearActionHandlers());

const GROUPS = Array.from({ length: 10 }, (_, i) => ({
  index: i + 1,
  name: `AG${i + 1}`,
  state: false,
}));

describe("ActionGroup at its registered default", () => {
  it("labels the button with the group a press toggles", async () => {
    const config = getComponents().find((def) => def.id === "action-group")
      ?.defaultConfig as ActionGroupConfig;
    const fixture = setupStreamFixture({ pinnedUt: 1000, suspendFrames: true });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ag-default" }}>
          <ActionGroupComponent config={config} id="ag-default" w={6} h={6} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.control", {
        sas: true,
        sasMode: 0,
        rcs: false,
        gear: false,
        brakes: false,
        lights: false,
        throttle: 0,
        actionGroups: GROUPS,
      });
    });
    await screen.findByText("OFF");

    expect(screen.getByText("AG1")).toBeTruthy();
    act(() => {
      screen.getByRole("button", { name: "Toggle AG1" }).click();
    });
    expect(fixture.transport.sentCommands[0]).toMatchObject({
      command: "vessel.control.setActionGroup",
      args: { group: 1, state: true },
    });
    await act(async () => {});
  });
});
