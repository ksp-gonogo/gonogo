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

// Rendered trees, tracked so teardown can unmount them BEFORE clearing the
// action-handler registry: a still-mounted widget re-rendering on that
// notification is a state update outside act(), the documented anti-pattern
// in CLAUDE.md.
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

/** Stock's ten customs, all disengaged: the named-list shape the mod now sends. */
const STOCK_GROUPS_ALL_OFF = Array.from({ length: 10 }, (_, i) => ({
  index: i + 1,
  name: `AG${i + 1}`,
  state: false,
}));

/**
 * The toggle -> absolute command bridge, proven for a representative stock
 * singleton (SAS) and Abort: `ActionGroupComponent` firing a toggle dispatches
 * the `vessel.control.set*` COMMAND directly via `useCommand`,
 * unconditionally, with no
 * carried-channels gate and no legacy `DataSource.execute()` fallback: every
 * vessel command widget on this pattern (MechJeb, RoboticsConsole,
 * RotorTachometer) dispatches the same way.
 *
 * SAS (not an AG-index like `f.ag1`) is the vehicle here on purpose:
 * `toggleCommandFor`/`buildToggleArgs`'s doc comments explain why: SAS/RCS/
 * Gear/Brakes/Lights each have a clean per-field read home
 * (`vessel.control.sas` etc.), and THIS SAME WIDGET INSTANCE already
 * subscribes to that exact topic for its own state pill, so the invert is
 * built off a value already in hand, no extra read.
 */
afterEach(() => {
  unmountAll();
  clearActionHandlers();
});

describe("ActionGroup (SAS): the toggle -> absolute command dispatch", () => {
  it("clicking the SAS toggle dispatches vessel.control.setSas with the inverted state", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.control"],
      pinnedUt: 0,
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

    // Live SAS = true, so a click should invert it to `enabled: false`.
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

    // Fire-and-forget: the underlying command-request/response round trip
    // resolves on a queued microtask (StubTransport), so the handler call
    // must be awaited, not asserted synchronously right after the click.
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
      carriedChannels: ["vessel.control"],
      pinnedUt: 0,
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
      carriedChannels: ["vessel.control"],
      pinnedUt: 0,
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
