import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ActionGroupComponent } from "./index";

// Unmounted before the registry clears, so the clear never updates a mounted tree outside act().
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

function unmountAll() {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
}

/** Stock's ten custom groups, all disengaged. */
const STOCK_GROUPS_ALL_OFF = Array.from({ length: 10 }, (_, i) => ({
  index: i + 1,
  name: `AG${i + 1}`,
  state: false,
}));

afterEach(() => {
  unmountAll();
  clearActionHandlers();
});

describe("ActionGroup (SAS): the toggle -> absolute command dispatch", () => {
  it("clicking the SAS toggle dispatches vessel.control.setSas with the inverted state", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 0,
      suspendFrames: true,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ag-sas" }}>
          <ActionGroupComponent
            config={{ actionGroupId: "SAS" }}
            id="ag-sas"
            w={6}
            h={6}
          />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.control", {
        sas: true,
        sasMode: 0,
        rcs: false,
        gear: false,
        brakes: false,
        lights: false,
        throttle: 0,
        actionGroups: STOCK_GROUPS_ALL_OFF,
      });
    });

    await screen.findByText("ON");

    const button = screen.getByRole("button", { name: "Toggle SAS" });
    act(() => {
      button.click();
    });

    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("vessel.control.setSas", {
        enabled: false,
      }),
    );
  });
});

describe("ActionGroup (Abort): toggle -> absolute command dispatch", () => {
  it("shows the live Abort state and dispatches vessel.control.setAbort", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 0,
      suspendFrames: true,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ag-abort" }}>
          <ActionGroupComponent
            config={{ actionGroupId: "Abort" }}
            id="ag-abort"
            w={6}
            h={6}
          />
        </DashboardItemContext.Provider>
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
        actionGroups: STOCK_GROUPS_ALL_OFF,
      });
    });

    await screen.findByText("OFF");

    const button = screen.getByRole("button", { name: "Toggle Abort" });
    act(() => {
      button.click();
    });

    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("vessel.control.setAbort", {
        enabled: true,
      }),
    );
  });
});

describe("ActionGroup (Precision Control): read-only, no toggle command", () => {
  it("shows the live Precision Control state off the stream (no toggle key, read-only)", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 0,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ag-precision" }}>
          <ActionGroupComponent
            config={{ actionGroupId: "Precision Control" }}
            id="ag-precision"
            w={6}
            h={6}
          />
        </DashboardItemContext.Provider>
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
        precisionControl: true,
        throttle: 0,
        actionGroups: STOCK_GROUPS_ALL_OFF,
      });
    });

    await screen.findByText("ON");
    expect(
      screen.getByRole("button", { name: "Toggle Precision Control" }),
    ).toBeDisabled();
  });
});
