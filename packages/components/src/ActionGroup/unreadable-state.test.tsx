import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlarmsLauncherProvider } from "../shared/AlarmsLauncher";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ActionGroupComponent } from "./index";

/**
 * A group whose `state` is null (reported, but unreadable by a backend that
 * reads each group separately) renders unknown, holds its toggle and says why.
 */

const CONTROL_BASE = {
  sas: false,
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

const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

function mount(groupId: string, instanceId = `ag-unreadable-${groupId}`) {
  const fixture = setupStreamFixture({
    pinnedUt: 0,
    suspendFrames: true,
  });
  const commandHandler = vi.fn(() => ({ ok: true }));
  fixture.transport.setCommandHandler(commandHandler);
  const rendered = render(
    <fixture.Provider>
      <AlarmsLauncherProvider launcher={vi.fn()}>
        <DashboardItemContext.Provider value={{ instanceId }}>
          <ActionGroupComponent
            config={{ actionGroupId: groupId }}
            id={instanceId}
            w={6}
            h={6}
          />
        </DashboardItemContext.Provider>
      </AlarmsLauncherProvider>
    </fixture.Provider>,
  );
  return { fixture, commandHandler, ...rendered };
}

/** Let a fire-and-forget command settle, so "no dispatch" is a real observation. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ActionGroup when the backend could not read the group", () => {
  it("draws a readable group's state, so the withholding below is a decision", async () => {
    // Control: `false` is a real answer and must keep reading OFF on an operable toggle.
    const { fixture } = mount("Radiators", "ag-unreadable-control");
    act(() => {
      fixture.emit("vessel.control", {
        ...CONTROL_BASE,
        actionGroups: [{ index: 5, name: "Radiators", state: false }],
      });
    });

    const toggle = () =>
      screen.getByRole("button", { name: "Toggle Radiators" });
    await waitFor(() => expect(toggle().textContent).toBe("OFF"));
    expect(toggle()).not.toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("refuses to call an unread group OFF, and says which kind of unknown it is", async () => {
    const { fixture } = mount("Radiators");
    act(() => {
      fixture.emit("vessel.control", {
        ...CONTROL_BASE,
        actionGroups: [{ index: 5, name: "Radiators", state: null }],
      });
    });

    const toggle = () =>
      screen.getByRole("button", { name: "Toggle Radiators" });
    await waitFor(() => expect(toggle().textContent).toBe(NULL_DISPLAY));

    // The empty pill is also the cold and stale render, so the reason must say which.
    const reason = screen.getByRole("status");
    expect(reason.textContent).toBe("State unreadable");
    expect(reason.getAttribute("title")).toBe(
      "The backend reported this group but could not read whether it is engaged, so the toggle is held",
    );
  });

  it("holds the toggle rather than swallowing a press it cannot invert", async () => {
    const { fixture, commandHandler } = mount(
      "Radiators",
      "ag-unreadable-press",
    );
    act(() => {
      fixture.emit("vessel.control", {
        ...CONTROL_BASE,
        actionGroups: [{ index: 5, name: "Radiators", state: true }],
      });
    });
    const toggle = () =>
      screen.getByRole("button", { name: "Toggle Radiators" });
    await waitFor(() => expect(toggle().textContent).toBe("ON"));

    // The press reaches the wire while readable, so the refusal below is a refusal.
    act(() => {
      toggle().click();
    });
    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith(
        "vessel.control.setActionGroup",
        { group: 5, state: false },
      ),
    );
    expect(fixture.transport.sentCommands).toHaveLength(1);

    act(() => {
      fixture.emit("vessel.control", {
        ...CONTROL_BASE,
        actionGroups: [{ index: 5, name: "Radiators", state: null }],
      });
    });
    await waitFor(() => expect(toggle()).toBeDisabled());

    act(() => {
      toggle().click();
    });
    await settle();
    // No boolean to invert, so no absolute-set may be guessed.
    expect(fixture.transport.sentCommands).toHaveLength(1);
  });

  it("explains the empty pill rather than yielding to Paused, which explains nothing about it", async () => {
    const { fixture } = mount("Radiators", "ag-unreadable-paused");
    act(() => {
      fixture.emit("time.warp", { paused: true });
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.control", {
        ...CONTROL_BASE,
        actionGroups: [{ index: 5, name: "Radiators", state: null }],
      });
    });

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("State unreadable"),
    );
  });

  it("leaves a group nobody reported on its own reason line", async () => {
    // An `assumed` group also leaves the pill empty, so only the sentence separates the two.
    const { fixture } = mount("Radiators", "ag-unreadable-assumed");
    act(() => {
      fixture.emit("vessel.control", {
        ...CONTROL_BASE,
        actionGroups: [{ index: 9, name: "Something else", state: true }],
      });
    });

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Not reported"),
    );
  });
});
