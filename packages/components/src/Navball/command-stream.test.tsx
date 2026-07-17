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

/**
 * The command-table proof for Navball ("validate the vessel-control command
 * widgets' command side"), mirroring `ActionGroup/stream.test.tsx`'s pilot
 * pattern but covering the
 * three DISTINCT `map-command.ts` arg-shape bridges Navball's own control
 * surface exercises (the widget code is unchanged — this is test/validation
 * work proving the transparent command shim genuinely routes each one, not
 * a rewrite of the widget):
 *
 * 1. **toggle -> absolute** — the SAS ON/OFF button (`f.sas` ->
 *    `vessel.control.setSas`), same bridge `ActionGroup`'s pilot already
 *    covers, reproduced here because Navball's `ControlSurface` fires it
 *    through its own button rather than `ActionGroupComponent`'s.
 * 2. **positional -> named (enum)** — a SAS-mode button (`f.setSASMode
 *    [Prograde]` -> `vessel.control.setSasMode`, name -> ordinal bridge).
 * 3. **positional -> named (direct-actuation, no state to invert)** — the
 *    throttle ZERO button (`f.throttleZero` -> `vessel.control.setThrottle`).
 *
 * Every mapped action Navball declares that ISN'T one of these three bridge
 * shapes (`f.rcs`/`f.setThrottle`/`f.throttleFull` — each the SAME bridge as
 * one of the three above, just a different key) is covered at the
 * `map-command.ts` unit level already; this file's job is proving the
 * WIDGET's real button click genuinely reaches `TelemetryClient.dispatch`
 * end-to-end, not re-deriving `map-command.test.ts`'s own coverage.
 *
 * `f.throttleUp`/`f.throttleDown`/`arm-fbw`/`disarm-fbw`
 * (`v.setFbW`)/`set-pitch`/`set-yaw`/`set-roll`/`translate-*`/`set-*-trim`
 * are all `KNOWN_COMMAND_GAPS` — deliberately NOT exercised here; they stay
 * command-legacy (see `map-command.ts`'s own gap list). `Twr` (the other
 * Navball/Twr command-validation candidate) declares `actions: []` — no
 * `useExecuteAction` call at all, so there is nothing to validate there;
 * it's command-legacy by having no command surface whatsoever.
 *
 * Every test renders Navball in `controlMode: true` at a size that clears
 * `showControlSurface`'s gate (rows>=18, cols>=7) so the real DOM buttons
 * are present.
 */
const CONTROL_MODE_CONFIG = { controlMode: true };
const CONTROL_SIZE = { w: 10, h: 20 };

beforeEach(() => {
  // Navball registers ~30 actions via useActionInput on every mount — this
  // file mounts it 6 times (one per test) inside the same 1000ms rolling
  // window the `useActionInput register/sec` PerfBudget (threshold 50)
  // tracks, which would trip on the 2nd mount alone. Reset before each test
  // — the codebase's established idiom for this exact repeated-mount shape
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

describe("Navball control surface — command bridges (M3 batch 4, Part B)", () => {
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
        actionGroups: Array(10).fill(false),
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

  it("SAS toggle falls back to legacy execute() when the command topic isn't carried", async () => {
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
      "nav-cmd-sas-legacy",
      fixture.Provider,
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

    const button = await screen.findByRole("button", { name: "SAS ON" });
    act(() => {
      button.click();
    });

    await waitFor(() => expect(executed).toEqual(["f.sas"]));
    expect(commandHandler).not.toHaveBeenCalled();

    // Unmount BEFORE tearing the registry down: `clearRegistry()` notifies
    // every live `useDataSourceSubscription`, so clearing while the widget
    // is still mounted schedules a setState from outside React's act
    // boundary. Dropping the tree first leaves nothing to notify.
    unmount();
    buffered.disconnect();
    clearRegistry();
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
    // not toggle -> absolute) — the button is live from first render.
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

  it("SAS-mode Prograde button falls back to legacy execute() when the command topic isn't carried", async () => {
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
      "nav-cmd-mode-legacy",
      fixture.Provider,
    );

    const button = await screen.findByRole("button", { name: "PRO" });
    act(() => {
      button.click();
    });

    await waitFor(() => expect(executed).toEqual(["f.setSASMode[Prograde]"]));
    expect(commandHandler).not.toHaveBeenCalled();

    unmount();
    buffered.disconnect();
    clearRegistry();
  });

  it("throttle ZERO button dispatches vessel.control.setThrottle when promoted (bridge 3: positional -> named, no-invert)", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.control", "vessel.control.setThrottle"],
      pinnedUt: 0,
    });
    const commandHandler = vi.fn(() => ({ ok: true }));
    fixture.transport.setCommandHandler(commandHandler);

    renderControlNavball("nav-cmd-thr", fixture.Provider);

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
  });

  it("throttle ZERO button falls back to legacy execute() when the command topic isn't carried", async () => {
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
      "nav-cmd-thr-legacy",
      fixture.Provider,
    );

    const button = await screen.findByRole("button", { name: "ZERO" });
    act(() => {
      button.click();
    });

    await waitFor(() => expect(executed).toEqual(["f.throttleZero"]));
    expect(commandHandler).not.toHaveBeenCalled();

    unmount();
    buffered.disconnect();
    clearRegistry();
  });
});
