import {
  clearActionHandlers,
  clearRegistry,
  DashboardItemContext,
  MockDataSource,
  PerfBudget,
  registerDataSource,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
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
 * The command-table proof for Navball's control surface, covering the
 * DISTINCT `map-command.ts`-shaped arg bridges it exercises (the widget
 * code proves each one dispatches with the right envelope, not a re-
 * derivation of `map-command.test.ts`'s own coverage):
 *
 * 1. **toggle -> absolute (delayed-command-ux migration)**: the SAS ON/OFF
 *    button dispatches `vessel.control.setSas` directly via `useCommand`,
 *    same bridge shape `ActionGroup`'s own migration uses, built off the
 *    already-known live `sas` value instead of a `mapCommand` current-value
 *    sample. Unconditional now: no carried-channels gate, no legacy
 *    `DataSource` fallback (see `toggleSas` in index.tsx).
 * 2. **positional -> named enum (delayed-command-ux migration)**: a SAS-mode
 *    button dispatches `vessel.control.setSasMode` directly via
 *    `useCommand`, the mode name resolved to its ordinal off `SAS_MODES`'
 *    own array position (see `setSasMode` in index.tsx). Also unconditional.
 * 3. **continuous, delayed control-stream (control-delay-stream-viz Task 4)**:
 *    the throttle ZERO button. Throttle is now the one continuous axis with
 *    a real bidirectional channel (`vessel.control.throttle`), so it rides
 *    `useControlStream` instead of `useExecuteAction`: the button sets local
 *    commanded state, the hook's coalesced write half dispatches
 *    `vessel.control.setThrottle` on its own 10 Hz tick. Unconditional too,
 *    same as bridges 1/2: no carried-channels gate, no legacy `DataSource`
 *    fallback (the pre-migration version of this file proved the opposite:
 *    a carried-gated shim promotion with a legacy fallback; that shape is
 *    gone for throttle specifically).
 *
 * `set-pitch`/`set-yaw`/`set-roll`/`translate-*`/`set-*-trim` stay on the
 * legacy `useExecuteAction` string path + the carried-gated `map-command.ts`
 * shim (K5 in the command-surface delay audit, unmigrated): `VesselControl`
 * has no pitch/yaw/roll READ fields or `[SitrepControlChannel]`
 * declarations yet, so there's no channel for those axes to ride, and
 * closing a full attitude-control loop across signal delay is a
 * control-theory problem needing a select-then-commit `CommandGroup` design
 * regardless. Not separately exercised here. `arm-fbw`/`disarm-fbw`
 * (`vessel.control.setFlyByWire`) DID migrate alongside SAS/SAS-mode (same
 * discrete-command shape) but aren't separately proven in this file; `Twr`
 * (the other Navball/Twr command-validation candidate) declares
 * `actions: []`: no command surface at all to validate.
 *
 * Every test renders Navball in `controlMode: true` at a size that clears
 * `showControlSurface`'s gate (rows>=18, cols>=7) so the real DOM buttons
 * are present.
 */
const CONTROL_MODE_CONFIG = { controlMode: true };
const CONTROL_SIZE = { w: 10, h: 20 };

beforeEach(() => {
  // Navball registers ~30 actions via useActionInput on every mount, this
  // file mounts it 6 times (one per test) inside the same 1000ms rolling
  // window the `useActionInput register/sec` PerfBudget (threshold 50)
  // tracks, which would trip on the 2nd mount alone. Reset before each test,
  // the codebase's established idiom for this exact repeated-mount shape
  // (see Navball/dual-run.test.tsx, useActionInput.test.tsx).
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
  it("SAS toggle dispatches vessel.control.setSas when promoted (bridge 1: toggle -> absolute)", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.control", "vessel.control.setSas"],
      pinnedUt: 0,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    renderControlNavball("nav-cmd-sas", fixture.Provider);

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

    const button = await screen.findByRole("button", { name: "SAS ON" });
    act(() => {
      button.click();
    });

    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("vessel.control.setSas", {
        enabled: false,
      }),
    );
  });

  it("SAS toggle still dispatches vessel.control.setSas even when the command topic isn't in the carried allowlist", async () => {
    // useCommand (delayed-command-ux migration) dispatches unconditionally
    // via the client: no carried-channels gate, no legacy DataSource
    // fallback. Proves the carried allowlist genuinely stopped mattering for
    // this bridge.
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.control"],
      pinnedUt: 0,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    renderControlNavball("nav-cmd-sas-uncarried", fixture.Provider);

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

    const button = await screen.findByRole("button", { name: "SAS ON" });
    act(() => {
      button.click();
    });

    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("vessel.control.setSas", {
        enabled: false,
      }),
    );
  });

  it("SAS-mode Prograde button dispatches vessel.control.setSasMode when promoted (bridge 3: positional -> named enum)", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.control", "vessel.control.setSasMode"],
      pinnedUt: 0,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    renderControlNavball("nav-cmd-mode", fixture.Provider);

    // No current-value read needed for this bridge (positional -> named,
    // not toggle -> absolute): the button is live from first render.
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

  it("SAS-mode Prograde button still dispatches vessel.control.setSasMode even when the command topic isn't in the carried allowlist", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.control"],
      pinnedUt: 0,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    renderControlNavball("nav-cmd-mode-uncarried", fixture.Provider);

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
      // Deliberately NOT carrying vessel.control.setThrottle: proves the
      // control-stream's write half is unconditional, same as bridges 1/2.
      carriedChannels: ["vessel.control"],
      pinnedUt: 0,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    renderControlNavball("nav-cmd-thr", fixture.Provider);

    // FULL first so ZERO's dispatch is unambiguously caused by the click,
    // not just the coalesced write half's unconditional first-tick echo of
    // the already-0 default commanded state.
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
      carriedChannels: ["vessel.control"],
      pinnedUt: 0,
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
});
