import {
  clearActionHandlers,
  clearRegistry,
  DashboardItemContext,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
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
// action-handler registry or disconnecting a legacy source. RTL auto-cleanup
// runs after this file's afterEach, so it can't be relied on to unmount first —
// clearActionHandlers()/buffered.disconnect() firing on a still-mounted widget
// is a state update outside act(), the documented anti-pattern in CLAUDE.md.
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

/** Stock's ten customs, all disengaged — the named-list shape the mod now sends. */
const STOCK_GROUPS_ALL_OFF = Array.from({ length: 10 }, (_, i) => ({
  index: i + 1,
  name: `AG${i + 1}`,
  state: false,
}));

/**
 * The command-table proof for a representative toggle -> absolute widget
 * (mirrored from `WarpControl/stream.test.tsx`): `ActionGroupComponent`
 * firing its SAS toggle genuinely dispatches the new `vessel.control.setSas`
 * COMMAND once that command topic is promoted into the carried-channels
 * allowlist, and falls back to the unchanged legacy `execute()` when it isn't.
 *
 * SAS (not an AG-index like `f.ag1`) is the vehicle here on purpose:
 * `map-command.ts`'s `toggleHome`/`actionGroupHome` doc comments explain why
 * — SAS/RCS/Gear/Brakes/Lights each have a clean per-field read home
 * (`vessel.control.sas` etc.), and THIS SAME WIDGET INSTANCE already
 * subscribes to that exact topic for its own state pill (it reads
 * `vessel.control` canonically), so the toggle -> absolute bridge's
 * `getCurrentValue` reader is guaranteed live the moment the toggle button is
 * clickable. `f.ag1`..`f.ag10` map through the identical bridge (proven at the
 * unit level in `map-command.test.ts`) but read the DERIVED
 * `vessel.state.actionGroup{n}` home, which is fed by the same
 * `vessel.control` subscription this widget already holds.
 */
afterEach(() => {
  unmountAll();
  clearActionHandlers();
});

describe("ActionGroup (SAS) — the toggle -> absolute command bridge (M3)", () => {
  it("clicking the SAS toggle dispatches vessel.control.setSas when promoted, never the legacy execute()", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.control", "vessel.control.setSas"],
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

    // The widget fires `void execute(...)` (fire-and-forget, per
    // useExecuteAction's own contract) — the underlying command-request/
    // response round trip resolves on a queued microtask (StubTransport),
    // so the handler call must be awaited, not asserted synchronously right
    // after the click (mirrors WarpControl/stream.test.tsx's own dispatch
    // assertion).
    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("vessel.control.setSas", {
        enabled: false,
      }),
    );
  });

  it("clicking the SAS toggle falls back to legacy execute() when the command topic isn't carried", async () => {
    // vessel.control (read) is carried so the pill shows real state, but the
    // COMMAND topic is deliberately left out of the allowlist.
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.control"],
      pinnedUt: 0,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    clearRegistry();
    const executed: string[] = [];
    const legacySource = new MockDataSource({
      keys: [
        { key: "v.sasValue" },
        { key: "t.isPaused" },
        { key: "comm.connected" },
      ],
      onExecute: (action) => {
        executed.push(action);
      },
    });
    const buffered = new BufferedDataSource({
      source: legacySource,
      store: new MemoryStore(),
    });
    registerDataSource(buffered);
    await buffered.connect();

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ag-sas-legacy" }}>
          <ActionGroupComponent
            config={{ actionGroupId: "SAS" }}
            id="ag-sas-legacy"
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

    expect(commandHandler).not.toHaveBeenCalled();
    expect(executed).toEqual(["f.sas"]);

    unmountAll();
    buffered.disconnect();
    clearRegistry();
  });
});

describe("ActionGroup (Abort) — P4a un-gap: v.abortValue read + f.abort command", () => {
  it("shows the live Abort state and dispatches vessel.control.setAbort when the topic is carried", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.control", "vessel.control.setAbort"],
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

  it("falls back to legacy execute() when vessel.control.setAbort isn't carried", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.control"],
      pinnedUt: 0,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    clearRegistry();
    const executed: string[] = [];
    const legacySource = new MockDataSource({
      keys: [
        { key: "v.abortValue" },
        { key: "t.isPaused" },
        { key: "comm.connected" },
      ],
      onExecute: (action) => {
        executed.push(action);
      },
    });
    const buffered = new BufferedDataSource({
      source: legacySource,
      store: new MemoryStore(),
    });
    registerDataSource(buffered);
    await buffered.connect();

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "ag-abort-legacy" }}
        >
          <ActionGroupComponent
            config={{ actionGroupId: "Abort" }}
            id="ag-abort-legacy"
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

    expect(commandHandler).not.toHaveBeenCalled();
    expect(executed).toEqual(["f.abort"]);

    unmountAll();
    buffered.disconnect();
    clearRegistry();
  });
});

describe("ActionGroup (Precision Control) — P4a un-gap: v.precisionControlValue read", () => {
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
