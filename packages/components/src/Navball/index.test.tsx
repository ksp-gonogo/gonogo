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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import { NavballComponent } from "./index";

const KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "n.heading" },
  { key: "n.pitch" },
  { key: "n.roll" },
  { key: "n.heading2" },
  { key: "n.pitch2" },
  { key: "n.roll2" },
  { key: "f.sasMode" },
  { key: "f.sasEnabled" },
  { key: "f.precisionControl" },
  { key: "v.rcsValue" },
  { key: "f.throttle" },
  { key: "v.isControllable" },
  { key: "comm.signalDelay" },
];

function renderNavball(
  config: Parameters<typeof NavballComponent>[0]["config"] = {},
  size: { w: number; h: number } = { w: 8, h: 11 },
) {
  return render(
    <DashboardItemContext.Provider value={{ instanceId: "nav" }}>
      <NavballComponent config={config} id="nav" w={size.w} h={size.h} />
    </DashboardItemContext.Provider>,
  );
}

// Size large enough to meet the control-surface threshold (rows≥18,
// cols≥7). Keeps the control-mode tests close to the live wide-open
// dashboard slot.
const CONTROL_SIZE = { w: 9, h: 20 };

describe("NavballComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  let onExecute: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    clearRegistry();
    onExecute = vi.fn();
    source = new MockDataSource({ keys: KEYS, onExecute });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    cleanup();
    buffered.disconnect();
  });

  it("renders heading/pitch/roll readouts from the default root-part frame (n.*2)", () => {
    // Default config (useCoMFrame false) reads the root-part-referenced
    // frame — the n.*2 keys — per the widget's verified frame mapping (the
    // UNSUFFIXED n.heading is the CoM frame; see the component's ternary
    // comment and VesselAttitude.cs's class doc).
    renderNavball();
    act(() => {
      source.emit("n.heading2", 87.4);
      source.emit("n.pitch2", 12);
      source.emit("n.roll2", -5);
      // The CoM-frame key shouldn't influence the readout in the default mode.
      source.emit("n.heading", 999);
    });
    expect(screen.getByText("87°")).toBeInTheDocument();
    expect(screen.getByText("12°")).toBeInTheDocument();
    expect(screen.getByText("-5°")).toBeInTheDocument();
    expect(screen.queryByText("999°")).not.toBeInTheDocument();
  });

  it("uses CoM-frame keys (unsuffixed n.*) when configured", () => {
    renderNavball({ useCoMFrame: true });
    act(() => {
      source.emit("n.heading", 45);
      source.emit("n.pitch", 0);
      source.emit("n.roll", 0);
      // The root-part-frame key shouldn't influence the readout in this mode.
      source.emit("n.heading2", 999);
    });
    expect(screen.getByText("45°")).toBeInTheDocument();
    expect(screen.queryByText("999°")).not.toBeInTheDocument();
  });

  it("surfaces SAS mode in the badge", () => {
    renderNavball();
    act(() => {
      source.emit("f.sasEnabled", true);
      source.emit("f.sasMode", "Prograde");
    });
    expect(screen.getByText("SAS: Prograde")).toBeInTheDocument();
  });

  it("displays the control surface and fires Telemachus actions", async () => {
    const user = userEvent.setup();
    renderNavball({ controlMode: true }, CONTROL_SIZE);
    act(() => {
      source.emit("v.isControllable", true);
    });
    await user.click(screen.getByRole("button", { name: /^PRO$/ }));
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("f.setSASMode[Prograde]");
    });
  });

  it("disables control buttons when v.isControllable is false", () => {
    renderNavball({ controlMode: true }, CONTROL_SIZE);
    act(() => {
      source.emit("v.isControllable", false);
    });
    expect(screen.getByText(/Vessel not controllable/i)).toBeInTheDocument();
    const proButton = screen.getByRole("button", { name: /^PRO$/ });
    expect(proButton).toBeDisabled();
  });

  it("arms FBW on click and disarms on unmount", async () => {
    const user = userEvent.setup();
    const { unmount } = renderNavball({ controlMode: true }, CONTROL_SIZE);
    act(() => {
      source.emit("v.isControllable", true);
    });
    const armButton = screen.getByRole("button", { name: /Arm FBW/ });
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
    renderNavball({ controlMode: true }, CONTROL_SIZE);
    act(() => {
      source.emit("v.isControllable", true);
      source.emit("f.throttle", 0.25);
    });
    const slider = screen.getByRole("slider", { name: "Throttle" });
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
      const armButton = screen.getByRole("button", { name: /Arm FBW/ });
      await user.click(armButton);
      await waitFor(() => {
        expect(onExecute).toHaveBeenCalledWith("v.setFbW[1]");
      });
    }

    it("shows the warning badge and live-region caution when FBW is armed and delay is above threshold", async () => {
      const user = userEvent.setup();
      renderNavball({ controlMode: true }, CONTROL_SIZE);
      act(() => {
        source.emit("v.isControllable", true);
        source.emit("comm.signalDelay", 2.5);
      });
      await armFbw(user);

      expect(screen.getByText(/FBW.*DELAY/)).toBeInTheDocument();
      const delayStatus = findDelayStatus();
      expect(delayStatus).toBeDefined();
      expect(delayStatus).toHaveAttribute("aria-live", "polite");
    });

    it("hides the warning when FBW is disarmed even if delay is high", () => {
      renderNavball({ controlMode: true }, CONTROL_SIZE);
      act(() => {
        source.emit("v.isControllable", true);
        source.emit("comm.signalDelay", 2.5);
      });
      expect(screen.queryByText(/FBW.*DELAY/)).not.toBeInTheDocument();
      expect(findDelayStatus()).toBeUndefined();
    });

    it("hides the warning when FBW is armed but delay is at/below threshold", async () => {
      const user = userEvent.setup();
      renderNavball({ controlMode: true }, CONTROL_SIZE);
      act(() => {
        source.emit("v.isControllable", true);
        source.emit("comm.signalDelay", 0.2);
      });
      await armFbw(user);

      expect(screen.queryByText(/FBW.*DELAY/)).not.toBeInTheDocument();
      expect(findDelayStatus()).toBeUndefined();
    });

    it("has no axe violations when the warning is showing", async () => {
      const user = userEvent.setup();
      const { container } = renderNavball({ controlMode: true }, CONTROL_SIZE);
      act(() => {
        source.emit("v.isControllable", true);
        source.emit("comm.signalDelay", 3);
      });
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

  beforeEach(async () => {
    clearRegistry();
    clearAugments();
    source = new MockDataSource({ keys: KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    cleanup();
    clearAugments();
    buffered.disconnect();
  });

  it("renders the header badge row without an augment (empty slot is fine)", () => {
    // No augment bound → the slot composes to nothing; the stock SAS/RCS
    // badges still render and the widget doesn't crash.
    renderNavball();
    act(() => {
      source.emit("f.sasEnabled", true);
      source.emit("f.sasMode", "Prograde");
    });
    expect(screen.getByText("SAS: Prograde")).toBeInTheDocument();
    expect(screen.getByText("RCS")).toBeInTheDocument();
    expect(screen.queryByTestId("autopilot-badge")).toBeNull();
  });

  it("renders an augment bound to navball.badges alongside the SAS/RCS badges", () => {
    registerAugment({
      id: "test-autopilot-badge",
      augments: "navball.badges",
      component: () => <span data-testid="autopilot-badge">AP: ASCENT</span>,
    });
    renderNavball();
    act(() => {
      source.emit("f.sasEnabled", true);
      source.emit("f.sasMode", "Prograde");
    });
    // The augment composed into the header alongside the stock badges.
    expect(screen.getByTestId("autopilot-badge")).toHaveTextContent(
      "AP: ASCENT",
    );
    expect(screen.getByText("SAS: Prograde")).toBeInTheDocument();
  });
});
