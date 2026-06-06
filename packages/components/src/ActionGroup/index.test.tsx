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
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
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
  let executed: string[];

  beforeEach(async () => {
    clearRegistry();
    executed = [];
    source = new MockDataSource({
      keys: KEYS,
      onExecute: (action) => {
        executed.push(action);
      },
    });
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

  it("renders the state pill as a toggle button at the minimum 3×3 size", () => {
    renderGroup({ actionGroupId: "SAS" }, { w: 3, h: 3 });
    act(() => {
      source.emit("v.sasValue", false);
    });
    const pill = screen.getByRole("button", { name: /toggle sas/i });
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveTextContent("OFF");
    expect(pill).not.toBeDisabled();
  });

  it("reflects ON state via aria-pressed on the pill button", () => {
    renderGroup({ actionGroupId: "SAS" });
    act(() => {
      source.emit("v.sasValue", true);
    });
    expect(screen.getByRole("button", { name: /toggle sas/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("fires the group toggle action when the pill button is clicked", async () => {
    const user = userEvent.setup();
    renderGroup({ actionGroupId: "SAS" }, { w: 3, h: 3 });
    act(() => {
      source.emit("v.sasValue", false);
    });
    await user.click(screen.getByRole("button", { name: /toggle sas/i }));
    expect(executed).toEqual(["f.sas"]);
  });

  it("disables the pill for a group with no toggle key (Precision Control)", () => {
    renderGroup({ actionGroupId: "Precision Control" });
    expect(
      screen.getByRole("button", { name: /toggle precision control/i }),
    ).toBeDisabled();
  });

  it("has no axe violations with the pill toggle button", async () => {
    const { container } = renderGroup({ actionGroupId: "SAS" });
    act(() => {
      source.emit("v.sasValue", true);
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
