import {
  clearActionHandlers,
  clearRegistry,
  DashboardItemContext,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ActionGroupComponent } from "./index";

/**
 * The M3 command-table proof for a representative toggle -> absolute widget
 * (`m3-migration-plan.md`'s watch-item, mirrored from `WarpControl/stream
 * .test.tsx`'s pilot pattern): `ActionGroupComponent` firing its SAS toggle
 * genuinely dispatches the new `vessel.control.setSas` COMMAND once that
 * command topic is promoted into the carried-channels allowlist, and falls
 * back to the unchanged legacy `execute()` when it isn't.
 *
 * SAS (not an AG-index like `f.ag1`) is the vehicle here on purpose:
 * `map-command.ts`'s `toggleHome`/`actionGroupHome` doc comments explain why
 * — SAS/RCS/Gear/Brakes/Lights each have a clean per-field read home
 * (`vessel.control.sas` etc.), and THIS SAME WIDGET INSTANCE already
 * subscribes to that exact topic for its own state pill
 * (`useDataValue("data", "v.sasValue")`), so the toggle -> absolute bridge's
 * `getCurrentValue` reader is guaranteed live the moment the toggle button is
 * clickable. `f.ag1`..`f.ag10` map through the identical bridge (proven at
 * the unit level in `map-command.test.ts`) but read the RAW
 * `vessel.control.actionGroups.<i>` array element instead, which only
 * resolves once SOME widget on the dashboard subscribes to `vessel.control`
 * — not a guarantee a single isolated `ActionGroup` instance can provide on
 * its own, so it isn't exercised end-to-end here.
 */
afterEach(() => {
  cleanup();
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
        actionGroups: Array(10).fill(false),
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
        actionGroups: Array(10).fill(false),
      });
    });

    await screen.findByText("ON");

    const button = screen.getByRole("button", { name: "Toggle SAS" });
    act(() => {
      button.click();
    });

    expect(commandHandler).not.toHaveBeenCalled();
    expect(executed).toEqual(["f.sas"]);

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
        actionGroups: Array(10).fill(false),
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
        actionGroups: Array(10).fill(false),
      });
    });

    await screen.findByText("OFF");

    const button = screen.getByRole("button", { name: "Toggle Abort" });
    act(() => {
      button.click();
    });

    expect(commandHandler).not.toHaveBeenCalled();
    expect(executed).toEqual(["f.abort"]);

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
        actionGroups: Array(10).fill(false),
      });
    });

    await screen.findByText("ON");
    expect(
      screen.getByRole("button", { name: "Toggle Precision Control" }),
    ).toBeDisabled();
  });
});
