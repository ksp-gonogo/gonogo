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
import { ReadingProbe } from "../test/ReadingProbe";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ActionGroupComponent } from "./index";

/**
 * What absence means at each of ActionGroup's reads. The group value reads it as
 * unknown (NULL_DISPLAY); the pause and comms badges need a confirmed value to
 * fire; a `null` field is the same unknown as an absent one.
 */

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

function mount(
  groupId: string,
  instanceId = "ag-characterise",
  { probe = false }: { probe?: boolean } = {},
) {
  const fixture = setupStreamFixture({
    pinnedUt: 0,
    suspendFrames: true,
  });
  const commandHandler = vi.fn(() => ({ ok: true }));
  fixture.transport.setCommandHandler(commandHandler);
  render(
    <fixture.Provider>
      {probe && <ReadingProbe topic="vessel.control" />}
      <DashboardItemContext.Provider value={{ instanceId }}>
        <ActionGroupComponent
          config={{ actionGroupId: groupId }}
          id={instanceId}
          w={6}
          h={6}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, commandHandler };
}

/** Let a fire-and-forget command settle, so "no dispatch" is a real observation. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const CONTROL_ALL_OFF = {
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

describe("ActionGroup: nothing has arrived at all", () => {
  it("renders the configured group, named and enabled, with NULL_DISPLAY for its state", () => {
    mount("SAS");

    // SAS is a stock singleton, so it resolves with no `vessel.control` at all.
    expect(screen.queryByText("No action group configured")).toBeNull();

    const toggle = screen.getByRole("button", { name: "Toggle SAS" });
    expect(toggle.textContent).toBe(NULL_DISPLAY);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Rename SAS" })).toBeTruthy();
  });

  it("shows no unavailable badge: absent pause/comms reads are read as 'nothing to warn about'", () => {
    mount("SAS");

    expect(screen.queryByText("Paused")).toBeNull();
    expect(screen.queryByText("No signal")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Toggle SAS" }).getAttribute("title"),
    ).toBe("Toggle SAS");
  });
});

describe("ActionGroup: the absence gates", () => {
  it("`value === undefined` gate fires before the first sample and stops once one lands", async () => {
    const { fixture } = mount("SAS");

    expect(screen.getByRole("button", { name: "Toggle SAS" }).textContent).toBe(
      NULL_DISPLAY,
    );

    act(() => {
      fixture.emit("vessel.control", CONTROL_ALL_OFF);
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Toggle SAS" }).textContent,
      ).toBe("OFF"),
    );
  });

  it("`typeof value !== 'boolean'` gate fires: a click with nothing arrived dispatches NO command", async () => {
    const { fixture, commandHandler } = mount("SAS");

    act(() => {
      screen.getByRole("button", { name: "Toggle SAS" }).click();
    });
    await settle();

    expect(commandHandler).not.toHaveBeenCalled();
    expect(fixture.transport.sentCommands).toHaveLength(0);
  });

  it("`isPaused === true` gate is reachable: a confirmed pause DOES badge, an absent one does not", async () => {
    const { fixture } = mount("SAS");

    expect(screen.queryByText("Paused")).toBeNull();

    act(() => {
      fixture.emit("time.warp", {
        warpRate: 1,
        warpRateIndex: 0,
        warpMode: 0,
        paused: true,
      });
    });

    await waitFor(() => expect(screen.getByText("Paused")).toBeTruthy());
    expect(
      screen.getByRole("button", { name: "Toggle SAS" }).getAttribute("title"),
    ).toBe("Paused");
  });

  it("`commConnected === false` gate is reachable: a confirmed loss DOES badge, an absent one does not", async () => {
    const { fixture } = mount("SAS");

    expect(screen.queryByText("No signal")).toBeNull();

    act(() => {
      fixture.emit("comms.link", { connected: false });
    });

    await waitFor(() => expect(screen.getByText("No signal")).toBeTruthy());
  });
});

describe("ActionGroup (Stage): the one group whose absence gate does not block the command", () => {
  it("reads NULL_DISPLAY off an absent vessel.structure yet still commands a stage on click", async () => {
    const { fixture, commandHandler } = mount("Stage", "ag-stage");

    const toggle = screen.getByRole("button", { name: "Toggle Stage" });
    expect(toggle.textContent).toBe(NULL_DISPLAY);

    act(() => {
      toggle.click();
    });

    // The stage command takes no args, so it needs no value to build them from.
    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("vessel.control.stage", null),
    );
    expect(fixture.transport.sentCommands).toHaveLength(1);
  });
});

describe("ActionGroup: a partial payload", () => {
  it("a vessel.control that arrived WITHOUT the group's field reverts to NULL_DISPLAY", async () => {
    const { fixture, commandHandler } = mount("SAS");

    // A real value first, so the partial record below is provably delivered.
    act(() => {
      fixture.emit("vessel.control", { ...CONTROL_ALL_OFF, sas: true });
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Toggle SAS" }).textContent,
      ).toBe("ON"),
    );

    act(() => {
      // The record arrives without `sas`, so the last known value is discarded, not held.
      const { sas: _dropped, ...withoutSas } = CONTROL_ALL_OFF;
      fixture.emit("vessel.control", withoutSas);
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Toggle SAS" }).textContent,
      ).toBe(NULL_DISPLAY),
    );

    act(() => {
      screen.getByRole("button", { name: "Toggle SAS" }).click();
    });
    await settle();
    expect(commandHandler).not.toHaveBeenCalled();
  });

  it("a custom group missing from the arrived actionGroups list reads unknown, not off", async () => {
    // A saved custom group missing from the list (its mod uninstalled, say) is unknown, not off.
    const { fixture } = mount("AG1", "ag-custom", { probe: true });

    act(() => {
      fixture.emit("vessel.control", {
        ...CONTROL_ALL_OFF,
        actionGroups: [{ index: 4, name: "AG4", state: true }],
      });
    });
    await screen.findByText("vessel.control: observed");

    const toggle = screen.getByRole("button", { name: "Toggle AG1" });
    expect(toggle.textContent).toBe(NULL_DISPLAY);
    expect(toggle).not.toBeDisabled();
  });
});

describe("ActionGroup: null versus undefined", () => {
  it("a NULL field reads as unknown, matching the command path that already refused it", async () => {
    const { fixture, commandHandler } = mount("SAS");

    act(() => {
      fixture.emit("vessel.control", { ...CONTROL_ALL_OFF, sas: null });
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Toggle SAS" }).textContent,
      ).toBe(NULL_DISPLAY),
    );
    expect(screen.getByRole("button", { name: "Toggle SAS" })).toBeDisabled();

    act(() => {
      screen.getByRole("button", { name: "Toggle SAS" }).click();
    });
    await settle();
    expect(commandHandler).not.toHaveBeenCalled();
  });

  it("a whole-topic tombstone reads exactly like nothing having arrived", async () => {
    const { fixture } = mount("SAS");

    // An observed value first, so the tombstone is provably delivered.
    act(() => {
      fixture.emit("vessel.control", { ...CONTROL_ALL_OFF, sas: true });
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Toggle SAS" }).textContent,
      ).toBe("ON"),
    );

    act(() => {
      fixture.emit("vessel.control", null);
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Toggle SAS" }).textContent,
      ).toBe(NULL_DISPLAY),
    );
    expect(screen.queryByText("No action group configured")).toBeNull();
  });
});
