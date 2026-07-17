import type { DataKey } from "@ksp-gonogo/core";
import {
  clearAugments,
  clearRegistry,
  DashboardItemContext,
  MockDataSource,
  registerAugment,
  registerDataSource,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

// Legacy source keys: the widget's ACTIONS still route through
// useExecuteAction("data"), and its connectivity badge reads the legacy
// "data" status — so a legacy source stays registered for those. Every VALUE
// read is off the stream now.
const KEYS: DataKey[] = [{ key: "n.heading" }];

// The read topics the widget now consumes off the stream. `vessel.state`
// (sasMode/isControllable) needs vessel.orbit + vessel.flight present to
// resolve its record; comms.delay feeds the FBW-delay warning.
const READ_CHANNELS = [
  "vessel.attitude",
  "vessel.control",
  "vessel.orbit",
  "vessel.flight",
  "vessel.comms",
  "comms.delay",
];

// Size large enough to meet the control-surface threshold (rows≥18,
// cols≥7). Keeps the control-mode tests close to the live wide-open
// dashboard slot.
const CONTROL_SIZE = { w: 9, h: 20 };

interface EmitState {
  attitude?: Record<string, number>;
  control?: Record<string, unknown>;
  comms?: Record<string, unknown>;
  delaySeconds?: number;
}

/** Emit the read topics. Always seeds the vessel.state record (orbit Loaded +
 * flight) so sasModeName/isControllable resolve when control/comms are given. */
function emitReads(fixture: StreamFixture, state: EmitState): void {
  act(() => {
    fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
    fixture.emit("vessel.flight", {
      latitude: 0,
      longitude: 0,
      altitudeAsl: 0,
      surfaceSpeed: 0,
      verticalSpeed: 0,
    });
    if (state.attitude) fixture.emit("vessel.attitude", state.attitude);
    if (state.control) fixture.emit("vessel.control", state.control);
    if (state.comms) fixture.emit("vessel.comms", state.comms);
    if (state.delaySeconds !== undefined) {
      fixture.emit("comms.delay", { oneWaySeconds: state.delaySeconds });
    }
  });
}

describe("NavballComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  let onExecute: ReturnType<typeof vi.fn>;
  // Unmount before buffered.disconnect() (a status change that re-renders the
  // still-mounted connectivity badge) — the act() anti-pattern otherwise.
  const trees: Array<() => void> = [];

  beforeEach(async () => {
    clearRegistry();
    onExecute = vi.fn();
    source = new MockDataSource({ keys: KEYS, onExecute });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    for (const unmount of trees) unmount();
    trees.length = 0;
    buffered.disconnect();
  });

  function renderNavball(
    config: Parameters<typeof NavballComponent>[0]["config"] = {},
    size: { w: number; h: number } = { w: 8, h: 11 },
  ) {
    const fixture = setupStreamFixture({
      carriedChannels: READ_CHANNELS,
      pinnedUt: 10,
    });
    const result = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "nav" }}>
          <NavballComponent config={config} id="nav" w={size.w} h={size.h} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    trees.push(result.unmount);
    return { ...result, fixture };
  }

  it("renders heading/pitch/roll readouts from the default root-part frame (n.*2)", async () => {
    // Default config (useCoMFrame false) reads the root-part-referenced
    // frame — vessel.attitude.*RootFrame — per the widget's verified frame
    // mapping (the UNSUFFIXED n.heading is the CoM frame; see the component's
    // ternary comment and VesselAttitude.cs's class doc).
    const { fixture } = renderNavball();
    emitReads(fixture, {
      attitude: {
        headingRootFrame: 87.4,
        pitchRootFrame: 12,
        rollRootFrame: -5,
        // The CoM-frame field shouldn't influence the readout in default mode.
        heading: 999,
      },
    });
    expect(await screen.findByText("87°")).toBeInTheDocument();
    expect(screen.getByText("12°")).toBeInTheDocument();
    expect(screen.getByText("-5°")).toBeInTheDocument();
    expect(screen.queryByText("999°")).not.toBeInTheDocument();
  });

  it("uses CoM-frame keys (unsuffixed n.*) when configured", async () => {
    const { fixture } = renderNavball({ useCoMFrame: true });
    emitReads(fixture, {
      attitude: {
        heading: 45,
        pitch: 0,
        roll: 0,
        // The root-part-frame field shouldn't influence the readout here.
        headingRootFrame: 999,
      },
    });
    expect(await screen.findByText("45°")).toBeInTheDocument();
    expect(screen.queryByText("999°")).not.toBeInTheDocument();
  });

  it("surfaces SAS mode in the badge", async () => {
    const { fixture } = renderNavball();
    // sasMode -> vessel.state.sasModeName, derived from vessel.control.sasMode
    // (1 = Prograde).
    emitReads(fixture, { control: { sas: true, sasMode: 1 } });
    expect(await screen.findByText("SAS: Prograde")).toBeInTheDocument();
  });

  it("displays the control surface and fires Telemachus actions", async () => {
    const user = userEvent.setup();
    const { fixture } = renderNavball({ controlMode: true }, CONTROL_SIZE);
    emitReads(fixture, { comms: { controlState: 4 } });
    await user.click(await screen.findByRole("button", { name: /^PRO$/ }));
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("f.setSASMode[Prograde]");
    });
  });

  it("disables control buttons when isControllable is false", async () => {
    const { fixture } = renderNavball({ controlMode: true }, CONTROL_SIZE);
    // ControlState.None (0) collapses to not-controllable.
    emitReads(fixture, { comms: { controlState: 0 } });
    expect(
      await screen.findByText(/Vessel not controllable/i),
    ).toBeInTheDocument();
    const proButton = screen.getByRole("button", { name: /^PRO$/ });
    expect(proButton).toBeDisabled();
  });

  it("arms FBW on click and disarms on unmount", async () => {
    const user = userEvent.setup();
    const { fixture, unmount } = renderNavball(
      { controlMode: true },
      CONTROL_SIZE,
    );
    emitReads(fixture, { comms: { controlState: 4 } });
    const armButton = await screen.findByRole("button", { name: /Arm FBW/ });
    await user.click(armButton);
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("v.setFbW[1]");
    });
    onExecute.mockClear();
    unmount();
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("v.setFbW[0]");
    });
  });

  it("formats throttle slider input as f.setThrottle[...]", async () => {
    const { fixture } = renderNavball({ controlMode: true }, CONTROL_SIZE);
    emitReads(fixture, {
      comms: { controlState: 4 },
      control: { throttle: 0.25 },
    });
    const slider = await screen.findByRole("slider", { name: "Throttle" });
    // Range inputs have no userEvent equivalent (type/selectOptions don't apply);
    // fireEvent.change is the RTL-recommended way to set a slider value.
    fireEvent.change(slider, { target: { value: "0.75" } });
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("f.setThrottle[0.750]");
    });
  });

  describe("FBW-under-delay warning", () => {
    // `role="status"` doesn't compute an accessible name from content (only
    // aria-label/aria-labelledby), and `StreamStatusBadge` already owns a
    // sibling status region ("OFFLINE") — so identify our live region by its
    // actual text content across `screen.getAllByRole("status")` rather than
    // an accessible-name query.
    function findDelayStatus(): HTMLElement | undefined {
      return screen
        .getAllByRole("status")
        .find((el) => /High signal delay/i.test(el.textContent ?? ""));
    }

    async function armFbw(user: ReturnType<typeof userEvent.setup>) {
      const armButton = await screen.findByRole("button", { name: /Arm FBW/ });
      await user.click(armButton);
      await waitFor(() => {
        expect(onExecute).toHaveBeenCalledWith("v.setFbW[1]");
      });
    }

    it("shows the warning badge and live-region caution when FBW is armed and delay is above threshold", async () => {
      const user = userEvent.setup();
      const { fixture } = renderNavball({ controlMode: true }, CONTROL_SIZE);
      emitReads(fixture, { comms: { controlState: 4 }, delaySeconds: 2.5 });
      await armFbw(user);

      expect(screen.getByText(/FBW.*DELAY/)).toBeInTheDocument();
      const delayStatus = findDelayStatus();
      expect(delayStatus).toBeDefined();
      expect(delayStatus).toHaveAttribute("aria-live", "polite");
    });

    it("hides the warning when FBW is disarmed even if delay is high", async () => {
      const { fixture } = renderNavball({ controlMode: true }, CONTROL_SIZE);
      emitReads(fixture, { comms: { controlState: 4 }, delaySeconds: 2.5 });
      await screen.findByRole("button", { name: /Arm FBW/ });
      expect(screen.queryByText(/FBW.*DELAY/)).not.toBeInTheDocument();
      expect(findDelayStatus()).toBeUndefined();
    });

    it("hides the warning when FBW is armed but delay is at/below threshold", async () => {
      const user = userEvent.setup();
      const { fixture } = renderNavball({ controlMode: true }, CONTROL_SIZE);
      emitReads(fixture, { comms: { controlState: 4 }, delaySeconds: 0.2 });
      await armFbw(user);

      expect(screen.queryByText(/FBW.*DELAY/)).not.toBeInTheDocument();
      expect(findDelayStatus()).toBeUndefined();
    });

    it("has no axe violations when the warning is showing", async () => {
      const user = userEvent.setup();
      const { container, fixture } = renderNavball(
        { controlMode: true },
        CONTROL_SIZE,
      );
      emitReads(fixture, { comms: { controlState: 4 }, delaySeconds: 3 });
      await armFbw(user);
      await waitFor(() => {
        expect(screen.getByText(/FBW.*DELAY/)).toBeInTheDocument();
      });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});

describe("Navball — navball.badges augment slot (spec §4)", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  const trees: Array<() => void> = [];

  beforeEach(async () => {
    clearRegistry();
    clearAugments();
    source = new MockDataSource({ keys: KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    // Unmount before the state-mutating teardown: clearAugments() notifies the
    // AugmentSlot subscribers and buffered.disconnect() re-renders the
    // connectivity badge — both are the act() anti-pattern against a live tree.
    for (const unmount of trees) unmount();
    trees.length = 0;
    clearAugments();
    buffered.disconnect();
  });

  function renderNavball() {
    const fixture = setupStreamFixture({
      carriedChannels: READ_CHANNELS,
      pinnedUt: 10,
    });
    const result = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "nav" }}>
          <NavballComponent config={{}} id="nav" w={8} h={11} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    trees.push(result.unmount);
    return { ...result, fixture };
  }

  it("renders the header badge row without an augment (empty slot is fine)", async () => {
    // No augment bound → the slot composes to nothing; the stock SAS/RCS
    // badges still render and the widget doesn't crash.
    const { fixture } = renderNavball();
    emitReads(fixture, { control: { sas: true, sasMode: 1, rcs: false } });
    expect(await screen.findByText("SAS: Prograde")).toBeInTheDocument();
    expect(screen.getByText("RCS")).toBeInTheDocument();
    expect(screen.queryByTestId("autopilot-badge")).toBeNull();
  });

  it("renders an augment bound to navball.badges alongside the SAS/RCS badges", async () => {
    registerAugment({
      id: "test-autopilot-badge",
      augments: "navball.badges",
      component: () => <span data-testid="autopilot-badge">AP: ASCENT</span>,
    });
    const { fixture } = renderNavball();
    emitReads(fixture, { control: { sas: true, sasMode: 1 } });
    // The augment composed into the header alongside the stock badges.
    expect(await screen.findByText("SAS: Prograde")).toBeInTheDocument();
    expect(screen.getByTestId("autopilot-badge")).toHaveTextContent(
      "AP: ASCENT",
    );
  });
});
