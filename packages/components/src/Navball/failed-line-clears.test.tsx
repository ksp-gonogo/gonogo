import {
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
} from "@ksp-gonogo/core";
import { GAME_LOAD_NOTICE_SECONDS } from "@ksp-gonogo/sitrep-sdk/spine";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

afterEach(() => {
  clearActionHandlers();
  vi.useRealTimers();
});

function mountFailing(instanceId: string, code: string) {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  fixture.transport.setCommandHandler(() => {
    throw Object.assign(new Error("failed"), { code });
  });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <NavballComponent
          config={{ controlMode: true }}
          id={instanceId}
          w={10}
          h={20}
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
      actionGroups: [],
    });
  });
}

const railText = () =>
  document.querySelector("[data-panel-rail-frame]")?.textContent ?? "";

const PRESS = { kind: "button", value: true } as const;

describe("a Navball command a game load undid", () => {
  it("shows its failed line and count, and both are gone after the notice time", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mountFailing("nav-undone", "undoneByLoad");
    act(() => {
      dispatchAction("nav-undone", "toggle-rcs", PRESS);
    });
    await waitFor(() =>
      expect(railText()).toContain("a game load undid it before it ran"),
    );
    expect(railText()).toContain("1 command failed");

    act(() => {
      vi.advanceTimersByTime((GAME_LOAD_NOTICE_SECONDS - 1) * 1000);
    });
    expect(railText()).toContain("1 command failed");

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(railText()).not.toContain("a game load undid it");
    expect(railText()).not.toContain("command failed");
  });

  it("leaves a failure with any other cause on screen", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mountFailing("nav-other", "continuousInputWouldWait");
    act(() => {
      dispatchAction("nav-other", "toggle-rcs", PRESS);
    });
    await waitFor(() => expect(railText()).toContain("1 command failed"));

    act(() => {
      vi.advanceTimersByTime(GAME_LOAD_NOTICE_SECONDS * 6000);
    });
    expect(railText()).toContain("1 command failed");
  });
});
