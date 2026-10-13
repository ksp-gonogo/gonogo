import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isDisabled } from "../test/isDisabled";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ActionGroupComponent } from "./index";

const CONTROL = {
  sas: true,
  sasMode: 0,
  rcs: false,
  gear: false,
  brakes: false,
  lights: false,
  abort: false,
  precisionControl: false,
  throttle: 0,
  actionGroups: [],
};

afterEach(() => {
  clearActionHandlers();
  vi.useRealTimers();
});

describe("ActionGroup across a stream drop and restore", () => {
  it("never draws the disabled dash, and keeps the last value pressable while it is drawn held", async () => {
    vi.useFakeTimers();
    const fixture = setupStreamFixture({ suspendFrames: true });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ag-restore" }}>
          <ActionGroupComponent
            config={{ actionGroupId: "SAS" }}
            id="ag-restore"
            w={6}
            h={6}
          />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    const toggle = () => screen.getByRole("button", { name: "Toggle SAS" });
    const frames: string[] = [];
    const sample = () =>
      frames.push(
        `${toggle().textContent?.split(",")[0]}|${toggle().querySelector("[data-held-mark]") ? "held" : "current"}|${isDisabled(toggle()) ? "disabled" : "enabled"}`,
      );

    act(() => {
      fixture.emit("vessel.control", CONTROL);
    });
    sample();

    act(() => {
      fixture.store.setTransportConnected(false);
      vi.advanceTimersByTime(20000);
      fixture.emitFrame();
    });
    sample();

    act(() => {
      fixture.store.setTransportConnected(true);
      fixture.store.setGameState("loading", "FLIGHT");
      vi.advanceTimersByTime(1000);
      fixture.emitFrame();
    });
    sample();

    act(() => {
      fixture.store.setGameState("ready", "FLIGHT");
      fixture.emitFrame();
    });
    sample();

    act(() => {
      fixture.emit("vessel.control", { ...CONTROL, sas: false });
    });
    sample();

    expect(frames.some((f) => f.startsWith(NULL_DISPLAY))).toBe(false);
    expect(frames[0]).toBe("ON|current|enabled");
    expect(frames[1]).toBe("ON|held|enabled");
    expect(frames[2]).toBe("ON|held|enabled");
    expect(frames[4]).toBe("OFF|current|enabled");
    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.emitFrame();
    });
    act(() => {
      toggle().click();
    });
    // The press is offered while the last value is held, and names the explicit opposite of it (the last value was OFF); the reply lands a microtask later.
    await act(async () => {});
    expect(commandHandler).toHaveBeenCalledWith("vessel.control.setSas", {
      enabled: true,
    });
  });
});
