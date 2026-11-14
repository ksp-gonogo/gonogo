import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlarmsLauncherProvider } from "../shared/AlarmsLauncher";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ActionGroupComponent } from "./index";

afterEach(() => clearActionHandlers());

describe("Stage refused with wrongScene", () => {
  it("says so on the control that was pressed", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    fixture.transport.setCommandHandler(
      vi.fn(() => ({
        success: false,
        errorCode: "wrongScene",
        detail: "there is no active craft",
      })),
    );
    render(
      <fixture.Provider>
        <AlarmsLauncherProvider launcher={vi.fn()}>
          <DashboardItemContext.Provider value={{ instanceId: "ws" }}>
            <ActionGroupComponent
              config={{ actionGroupId: "Stage" }}
              id="ws"
              w={6}
              h={6}
            />
          </DashboardItemContext.Provider>
        </AlarmsLauncherProvider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("vessel.control", {
        sas: false,
        sasMode: 0,
        rcs: false,
        gear: false,
        brakes: false,
        lights: false,
        abort: false,
        precisionControl: false,
        throttle: 0,
        actionGroups: [{ index: 0, name: "Stage", state: 3 }],
      });
      fixture.emit("vessel.structure", { currentStage: 3 });
    });
    const btn = await screen.findByRole("button", { name: "Toggle Stage" });
    act(() => {
      btn.click();
    });
    await waitFor(() => expect(fixture.transport.sentCommands.length).toBe(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    console.log("DOM", document.body.textContent);
    expect(document.body.textContent).toMatch(
      /not in a scene|no active craft|refused/i,
    );
  });
});
