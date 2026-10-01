import type { DataKey } from "@ksp-gonogo/core";
import {
  clearAugments,
  clearRegistry,
  DashboardItemContext,
  registerDataSource,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import { commandArgs, MockDataSource } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

const KEYS: DataKey[] = [{ key: "n.heading" }];

// Large enough to clear the control surface's size gate.
const CONTROL_SIZE = { w: 9, h: 20 };

interface EmitState {
  attitude?: Record<string, number>;
  control?: Record<string, unknown>;
  comms?: Record<string, unknown>;
  delaySeconds?: number;
  /** `vessel.identity.vesselId`: the active-vessel switch signal the throttle seed latch resets on. */
  vesselId?: string;
}

/** Emit whichever read topics `state` names. */
function emitReads(fixture: StreamFixture, state: EmitState): void {
  act(() => {
    if (state.attitude) fixture.emit("vessel.attitude", state.attitude);
    if (state.control) fixture.emit("vessel.control", state.control);
    if (state.comms) fixture.emit("vessel.comms", state.comms);
    if (state.delaySeconds !== undefined) {
      fixture.emit("comms.delay", { oneWaySeconds: state.delaySeconds });
    }
    if (state.vesselId !== undefined) {
      fixture.emit("vessel.identity", { vesselId: state.vesselId });
    }
  });
}

describe("NavballComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  // Unmounted before buffered.disconnect(), whose status change would re-render a mounted tree outside act().
  const trees: Array<() => void> = [];

  beforeEach(async () => {
    clearRegistry();
    source = new MockDataSource({ keys: KEYS });
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
      pinnedUt: 10,
      suspendFrames: true,
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
    await waitFor(() => expect(visibleText()).toContain("87°"));
    expect(visibleText()).toContain("12°");
    expect(visibleText()).toContain("-5°");
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
    await waitFor(() => expect(visibleText()).toContain("45°"));
    expect(screen.queryByText("999°")).not.toBeInTheDocument();
  });

  it("surfaces SAS mode on the SAS toggle", async () => {
    const { fixture } = renderNavball();
    // 1 = Prograde; on a display-sized tile the toggle is the only place the mode appears.
    emitReads(fixture, { control: { sas: true, sasMode: 1 } });
    expect(
      await screen.findByRole("button", { name: "SAS: PRO" }),
    ).toBeInTheDocument();
  });

  it("holds the SAS toggle and says why when the craft cannot engage SAS", async () => {
    const { fixture } = renderNavball();
    emitReads(fixture, {
      control: {
        sas: false,
        sasAvailable: false,
        sasUnavailableReason:
          "No SAS: needs a Pilot aboard or a probe core with SAS",
      },
    });
    const toggle = await screen.findByRole("button", { name: "SAS OFF" });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute(
      "title",
      "No SAS: needs a Pilot aboard or a probe core with SAS",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "No SAS: needs a Pilot aboard",
    );
  });

  it("leaves a SAS that is already on switchable off", async () => {
    const { fixture } = renderNavball();
    emitReads(fixture, {
      control: {
        sas: true,
        sasAvailable: false,
        sasUnavailableReason: "No SAS",
      },
    });
    expect(await screen.findByRole("button", { name: "SAS ON" })).toBeEnabled();
  });

  it("displays the control surface and dispatches vessel.control.setSasMode", async () => {
    const user = userEvent.setup();
    const { fixture } = renderNavball({ controlMode: true }, CONTROL_SIZE);
    emitReads(fixture, { comms: { controlState: 4 } });
    await user.click(await screen.findByRole("button", { name: /^PRO$/ }));
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "vessel.control.setSasMode",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ mode: 1 });
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
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "vessel.control.setFlyByWire",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ enabled: true });
    });
    unmount();
    await waitFor(() => {
      const sent = [...fixture.transport.sentCommands]
        .reverse()
        .find((c) => c.command === "vessel.control.setFlyByWire");
      expect(sent?.args).toEqual({ enabled: false });
    });
  });

  it("drives vessel.control.setThrottle via the delayed control-stream when the throttle slider moves", async () => {
    const { fixture } = renderNavball({ controlMode: true }, CONTROL_SIZE);
    emitReads(fixture, {
      comms: { controlState: 4 },
      control: { throttle: 0.25 },
    });
    const slider = await screen.findByRole("slider", { name: "Throttle" });
    // userEvent cannot set a range input.
    fireEvent.change(slider, { target: { value: "0.75" } });
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) =>
          c.command === "vessel.control.setThrottle" &&
          commandArgs<"vessel.control.setThrottle">(c.args).value === 0.75,
      );
      expect(sent).toBeDefined();
    });
  });

  it("re-seeds the commanded throttle from the new vessel's readback on a vessel switch, even after the old vessel's throttle was touched", async () => {
    // Touching the slider latches off readback seeding; the latch must reset per vessel.
    const { fixture } = renderNavball({ controlMode: true }, CONTROL_SIZE);
    emitReads(fixture, {
      comms: { controlState: 4 },
      control: { throttle: 0.25 },
      vesselId: "vessel-a",
    });
    const slider = await screen.findByRole("slider", { name: "Throttle" });
    await waitFor(() => expect(slider).toHaveValue("0.25"));

    fireEvent.change(slider, { target: { value: "0.75" } });
    await waitFor(() => expect(slider).toHaveValue("0.75"));

    emitReads(fixture, {
      comms: { controlState: 4 },
      control: { throttle: 0.6 },
      vesselId: "vessel-b",
    });
    await waitFor(() => expect(slider).toHaveValue("0.6"));
  });

  describe("FBW-under-delay warning", () => {
    // A status region takes no accessible name from its content, so it is found by text.
    function findDelayStatus(): HTMLElement | undefined {
      return screen
        .queryAllByRole("status")
        .find((el) => /High signal delay/i.test(el.textContent ?? ""));
    }

    async function armFbw(
      user: ReturnType<typeof userEvent.setup>,
      fixture: StreamFixture,
    ) {
      const armButton = await screen.findByRole("button", { name: /Arm FBW/ });
      await user.click(armButton);
      await waitFor(() => {
        expect(
          fixture.transport.sentCommands.find(
            (c) => c.command === "vessel.control.setFlyByWire",
          ),
        ).toBeDefined();
      });
    }

    it("shows the warning badge and live-region caution when FBW is armed and delay is above threshold", async () => {
      const user = userEvent.setup();
      const { fixture } = renderNavball({ controlMode: true }, CONTROL_SIZE);
      emitReads(fixture, { comms: { controlState: 4 }, delaySeconds: 2.5 });
      await armFbw(user, fixture);

      expect(screen.getByText(/FBW.*DELAY/)).toBeInTheDocument();
      const delayStatus = findDelayStatus();
      expect(delayStatus).toBeDefined();
      expect(delayStatus).toHaveAttribute("aria-live", "polite");
      // The delay figure ticks with every sample, so it sits outside the region that announces the warning.
      expect(delayStatus?.textContent).toBe("High signal delay");
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
      await armFbw(user, fixture);

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
      await armFbw(user, fixture);
      await waitFor(() => {
        expect(screen.getByText(/FBW.*DELAY/)).toBeInTheDocument();
      });

      await expectNoA11yViolations(container);
    });
  });
});

describe("Navball: navball.badges augment slot (spec §4)", () => {
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
    // Unmounted before clearAugments() and disconnect(), which would re-render a mounted tree outside act().
    for (const unmount of trees) unmount();
    trees.length = 0;
    clearAugments();
    buffered.disconnect();
  });

  function renderNavball() {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
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

  it("renders without an augment (empty slot is fine)", async () => {
    const { fixture } = renderNavball();
    emitReads(fixture, { control: { sas: true, sasMode: 1, rcs: false } });
    expect(
      await screen.findByRole("button", { name: "SAS: PRO" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "RCS OFF" })).toBeInTheDocument();
    expect(screen.queryByTestId("autopilot-badge")).toBeNull();
  });
});
