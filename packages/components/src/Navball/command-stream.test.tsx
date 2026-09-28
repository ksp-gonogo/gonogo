import {
  clearActionHandlers,
  clearRegistry,
  DashboardItemContext,
  dispatchAction,
  PerfBudget,
  registerDataSource,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import { MockDataSource } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import type { JSX, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

/** Stock's ten customs, all disengaged: the named-list shape the mod now sends. */
const STOCK_GROUPS_ALL_OFF = Array.from({ length: 10 }, (_, i) => ({
  index: i + 1,
  name: `AG${i + 1}`,
  state: false,
}));

/**
 * Each control-surface bridge dispatches the right command envelope: SAS toggle
 * to an absolute `setSas`, a SAS-mode button to its contract ordinal, throttle
 * through the coalesced control stream, and each trim as a `setAxes` carrying
 * only its own field (trim has no readback, so it cannot ride the stream).
 */
const CONTROL_MODE_CONFIG = { controlMode: true };
// Large enough to clear the control surface's size gate.
const CONTROL_SIZE = { w: 10, h: 20 };

beforeEach(() => {
  // Each mount registers ~30 actions, so back-to-back mounts would trip the register/sec budget.
  PerfBudget.getAll()
    .find((b) => b.name.startsWith("useActionInput register"))
    ?.reset();
});

afterEach(() => {
  clearActionHandlers();
});

function renderControlNavball(
  instanceId: string,
  Provider: (props: { children: ReactNode }) => JSX.Element,
) {
  return render(
    <Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <NavballComponent
          config={CONTROL_MODE_CONFIG}
          id={instanceId}
          w={CONTROL_SIZE.w}
          h={CONTROL_SIZE.h}
        />
      </DashboardItemContext.Provider>
    </Provider>,
  );
}

describe("Navball control surface: command bridges (M3 batch 4, Part B)", () => {
  it("SAS toggle dispatches vessel.control.setSas (bridge 1: toggle -> absolute)", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 0,
      suspendFrames: true,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    renderControlNavball("nav-cmd-sas", fixture.Provider);

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

    // The toggle names the held mode, StabilityAssist, so "SAS: SAS" is not a stutter.
    const button = await screen.findByRole("button", { name: "SAS: SAS" });
    act(() => {
      button.click();
    });

    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("vessel.control.setSas", {
        enabled: false,
      }),
    );
  });

  it("SAS-mode Prograde button dispatches vessel.control.setSasMode (bridge 3: positional -> named enum)", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 0,
      suspendFrames: true,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    renderControlNavball("nav-cmd-mode", fixture.Provider);

    const button = await screen.findByRole("button", { name: "PRO" });
    act(() => {
      button.click();
    });

    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("vessel.control.setSasMode", {
        mode: 1,
      }),
    );
  });

  it("throttle ZERO button drives vessel.control.setThrottle to 0 via the delayed control-stream (bridge 3: continuous, unconditional)", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 0,
      suspendFrames: true,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    renderControlNavball("nav-cmd-thr", fixture.Provider);

    // FULL first, so a 0 can only come from the ZERO click.
    const fullButton = await screen.findByRole("button", { name: "FULL" });
    act(() => {
      fullButton.click();
    });
    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith(
        "vessel.control.setThrottle",
        { value: 1 },
      ),
    );

    const zeroButton = screen.getByRole("button", { name: "ZERO" });
    act(() => {
      zeroButton.click();
    });
    await waitFor(() =>
      expect(commandHandler).toHaveBeenLastCalledWith(
        "vessel.control.setThrottle",
        { value: 0 },
      ),
    );
  });

  it("throttle ZERO button never falls back to legacy execute(): the axis has no legacy path left", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 0,
      suspendFrames: true,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    clearRegistry();
    const executed: string[] = [];
    const legacySource = new MockDataSource({
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

    const { unmount } = renderControlNavball(
      "nav-cmd-thr-no-legacy",
      fixture.Provider,
    );

    const button = await screen.findByRole("button", { name: "ZERO" });
    act(() => {
      button.click();
    });

    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith(
        "vessel.control.setThrottle",
        { value: 0 },
      ),
    );
    expect(executed).toEqual([]);

    unmount();
    buffered.disconnect();
    clearRegistry();
  });

  it("each trim action dispatches its own named vessel.control.setAxes field", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 0,
      suspendFrames: true,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    renderControlNavball("nav-cmd-trim", fixture.Provider);

    // Trim is input-only; a zero-padded triple would clobber a live axis.
    const { dispatchAction } = await import("@ksp-gonogo/core");
    for (const [action, field, value] of [
      ["set-pitch-trim", "pitchTrim", 0.25],
      ["set-yaw-trim", "yawTrim", -0.5],
      ["set-roll-trim", "rollTrim", 1],
    ] as const) {
      await act(async () => {
        await dispatchAction("nav-cmd-trim", action, {
          kind: "analog",
          value,
        });
      });
      await waitFor(() =>
        expect(commandHandler).toHaveBeenCalledWith("vessel.control.setAxes", {
          [field]: value,
        }),
      );
    }
  });

  it("clamps an out-of-range trim into the -1..1 the fly-by-wire override accepts", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 0,
      suspendFrames: true,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    renderControlNavball("nav-cmd-trim-clamp", fixture.Provider);

    const { dispatchAction } = await import("@ksp-gonogo/core");
    await act(async () => {
      await dispatchAction("nav-cmd-trim-clamp", "set-pitch-trim", {
        kind: "analog",
        value: 4.2,
      });
    });

    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("vessel.control.setAxes", {
        pitchTrim: 1,
      }),
    );
  });
});

describe("Navball commands nothing it was not asked to", () => {
  const STREAM_COMMANDS = [
    "vessel.control.setThrottle",
    "vessel.control.setAxes",
  ];

  function streamCalls(handler: ReturnType<typeof vi.fn>): unknown[][] {
    return handler.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" && STREAM_COMMANDS.includes(call[0]),
    );
  }

  /** Several 10 Hz control-stream ticks, held inside act. */
  async function letTheStreamTick(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
  }

  function mountDisplayOnly(instanceId: string) {
    const fixture = setupStreamFixture({
      pinnedUt: 0,
      suspendFrames: true,
    });
    const handler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(handler);
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId }}>
          <NavballComponent
            config={{}}
            id={instanceId}
            w={CONTROL_SIZE.w}
            h={CONTROL_SIZE.h}
          />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    return { fixture, handler };
  }

  it("sends no throttle or axis command when it mounts before any control reading", async () => {
    const { handler } = mountDisplayOnly("nav-no-intent");
    await letTheStreamTick();
    expect(streamCalls(handler)).toEqual([]);
  });

  it("does not send a delayed throttle readback back at the craft while untouched", async () => {
    const { fixture, handler } = mountDisplayOnly("nav-no-echo");
    act(() => {
      fixture.emit("comms.delay", { oneWaySeconds: 2 });
      fixture.emit("vessel.control", { throttle: 0.6 });
    });
    await letTheStreamTick();
    expect(streamCalls(handler)).toEqual([]);
  });

  it("still sends the throttle once the operator commands it", async () => {
    const { handler } = mountDisplayOnly("nav-touched");
    act(() => {
      dispatchAction("nav-touched", "set-throttle", {
        kind: "analog",
        value: 0.4,
      });
    });
    await waitFor(() =>
      expect(handler).toHaveBeenCalledWith("vessel.control.setThrottle", {
        value: 0.4,
      }),
    );
  });

  it("treats a NaN analog throttle as no command, never as a cut", async () => {
    const { handler } = mountDisplayOnly("nav-nan");
    act(() => {
      dispatchAction("nav-nan", "set-throttle", {
        kind: "analog",
        value: Number.NaN,
      });
    });
    await letTheStreamTick();
    expect(streamCalls(handler)).toEqual([]);
  });

  it("refuses a 10% step while the throttle has neither a reading nor a command", async () => {
    const { handler } = mountDisplayOnly("nav-step-blind");
    act(() => {
      dispatchAction("nav-step-blind", "throttle-up", {
        kind: "button",
        value: true,
      });
    });
    await letTheStreamTick();
    expect(streamCalls(handler)).toEqual([]);
  });

  it("steps from the confirmed throttle once one is read", async () => {
    const { fixture, handler } = mountDisplayOnly("nav-step-read");
    act(() => {
      fixture.emit("vessel.control", { throttle: 0.5 });
    });
    act(() => {
      dispatchAction("nav-step-read", "throttle-up", {
        kind: "button",
        value: true,
      });
    });
    await waitFor(() =>
      expect(handler).toHaveBeenCalledWith("vessel.control.setThrottle", {
        value: 0.6,
      }),
    );
  });
});
