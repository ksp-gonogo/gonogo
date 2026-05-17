import type { DataKey } from "@gonogo/core";
import {
  clearActionHandlers,
  clearRegistry,
  DashboardItemContext,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionGroupComponent } from "./index";

const KEYS: DataKey[] = [
  { key: "v.sasValue" },
  { key: "v.rcsValue" },
  { key: "v.gearValue" },
  { key: "v.brakeValue" },
  { key: "v.lightValue" },
  { key: "v.ag1Value" },
  { key: "t.isPaused" },
  { key: "comm.connected" },
];

describe("ActionGroupComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;

  beforeEach(async () => {
    clearRegistry();
    source = new MockDataSource({ keys: KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    cleanup();
    buffered.disconnect();
    clearActionHandlers();
  });

  function renderGroup(
    config: { actionGroupId?: string; label?: string } = {
      actionGroupId: "SAS",
    },
    size?: { w?: number; h?: number },
  ) {
    return render(
      <DashboardItemContext.Provider value={{ instanceId: "action-group" }}>
        <ActionGroupComponent
          config={config}
          id="action-group"
          w={size?.w ?? 6}
          h={size?.h ?? 6}
        />
      </DashboardItemContext.Provider>,
    );
  }

  it("shows the 'No action group configured' placeholder when config is missing", () => {
    renderGroup({ actionGroupId: undefined as unknown as string });
    expect(screen.getByText("No action group configured")).toBeInTheDocument();
  });

  it("shows the '—' unknown indicator before telemetry arrives", () => {
    renderGroup({ actionGroupId: "SAS" });
    // No emit yet — value is undefined → unknown state
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows OFF when the group value is false", () => {
    renderGroup({ actionGroupId: "SAS" });
    act(() => {
      source.emit("v.sasValue", false);
    });
    expect(screen.getByText("OFF")).toBeInTheDocument();
  });

  it("shows ON when the group value is true", () => {
    renderGroup({ actionGroupId: "SAS" });
    act(() => {
      source.emit("v.sasValue", true);
      source.emit("comm.connected", true);
      source.emit("t.isPaused", false);
    });
    expect(screen.getByText("ON")).toBeInTheDocument();
  });

  it("surfaces the Paused unavailability notice when the game is paused", () => {
    renderGroup({ actionGroupId: "SAS" }, { w: 6, h: 6 });
    act(() => {
      source.emit("v.sasValue", true);
      source.emit("t.isPaused", true);
      source.emit("comm.connected", true);
    });
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("surfaces the No signal unavailability notice when comm is disconnected", () => {
    renderGroup({ actionGroupId: "SAS" }, { w: 6, h: 6 });
    act(() => {
      source.emit("v.sasValue", false);
      source.emit("t.isPaused", false);
      source.emit("comm.connected", false);
    });
    expect(screen.getByText("No signal")).toBeInTheDocument();
  });

  it("suppresses the unavailability notice in the tiny size bucket (w<5)", () => {
    // At 3×4 the widget is in the tiny bucket — UnavailableNotice must not render.
    renderGroup({ actionGroupId: "SAS" }, { w: 3, h: 4 });
    act(() => {
      source.emit("v.sasValue", false);
      source.emit("t.isPaused", true);
      source.emit("comm.connected", false);
    });
    expect(screen.queryByText("Paused")).not.toBeInTheDocument();
    expect(screen.queryByText("No signal")).not.toBeInTheDocument();
  });

  it("shows the custom label when one is configured", () => {
    renderGroup({ actionGroupId: "AG1", label: "Chutes" });
    act(() => {
      source.emit("v.ag1Value", true);
    });
    expect(screen.getByText("Chutes")).toBeInTheDocument();
  });

  it("shows the official group name as secondary when a custom label is set (cols≥5)", () => {
    renderGroup({ actionGroupId: "AG1", label: "Chutes" }, { w: 6, h: 6 });
    act(() => {
      source.emit("v.ag1Value", false);
    });
    // OfficialName = "AG1", custom label = "Chutes"; at cols=6 both visible
    expect(screen.getByText("Chutes")).toBeInTheDocument();
    expect(screen.getByText("AG1")).toBeInTheDocument();
  });

  it("reads the correct value key for non-SAS groups (Gear)", () => {
    renderGroup({ actionGroupId: "Gear" });
    act(() => {
      source.emit("v.gearValue", true);
    });
    expect(screen.getByText("ON")).toBeInTheDocument();
  });
});
