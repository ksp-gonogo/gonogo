import type { DataKey } from "@gonogo/core";
import {
  clearRegistry,
  DashboardItemContext,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
];

function renderNavball(
  config: Parameters<typeof NavballComponent>[0]["config"] = {},
) {
  return render(
    <DashboardItemContext.Provider value={{ instanceId: "nav" }}>
      <NavballComponent config={config} id="nav" />
    </DashboardItemContext.Provider>,
  );
}

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

  it("renders heading/pitch/roll readouts from n.* keys", () => {
    renderNavball();
    act(() => {
      source.emit("n.heading", 87.4);
      source.emit("n.pitch", 12);
      source.emit("n.roll", -5);
    });
    expect(screen.getByText("87°")).toBeInTheDocument();
    expect(screen.getByText("12°")).toBeInTheDocument();
    expect(screen.getByText("-5°")).toBeInTheDocument();
  });

  it("uses CoM-frame keys when configured", () => {
    renderNavball({ useCoMFrame: true });
    act(() => {
      source.emit("n.heading2", 45);
      source.emit("n.pitch2", 0);
      source.emit("n.roll2", 0);
      // n.heading shouldn't influence the readout in this mode
      source.emit("n.heading", 999);
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
    renderNavball({ controlMode: true });
    act(() => {
      source.emit("v.isControllable", true);
    });
    fireEvent.click(screen.getByRole("button", { name: /^PRO$/ }));
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("f.setSASMode[Prograde]");
    });
  });

  it("disables control buttons when v.isControllable is false", () => {
    renderNavball({ controlMode: true });
    act(() => {
      source.emit("v.isControllable", false);
    });
    expect(screen.getByText(/Vessel not controllable/i)).toBeInTheDocument();
    const proButton = screen.getByRole("button", { name: /^PRO$/ });
    expect(proButton).toBeDisabled();
  });

  it("arms FBW on click and disarms on unmount", async () => {
    const { unmount } = renderNavball({ controlMode: true });
    act(() => {
      source.emit("v.isControllable", true);
    });
    const armButton = screen.getByRole("button", { name: /Arm FBW/ });
    fireEvent.click(armButton);
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("v.setFbW[1]");
    });
    onExecute.mockClear();
    unmount();
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("v.setFbW[0]");
    });
  });

  it("formats throttle slider input as f.setThrottle[…]", async () => {
    renderNavball({ controlMode: true });
    act(() => {
      source.emit("v.isControllable", true);
      source.emit("f.throttle", 0.25);
    });
    const slider = screen.getByRole("slider", { name: "Throttle" });
    fireEvent.change(slider, { target: { value: "0.75" } });
    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("f.setThrottle[0.750]");
    });
  });
});
