import type { DataKey } from "@ksp-gonogo/core";
import {
  clearActionHandlers,
  clearAugments,
  clearRegistry,
  DashboardItemContext,
  MockDataSource,
  registerAugment,
  registerDataSource,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import { act, render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ActionGroupComponent, type ActionGroupSlotContext } from "./index";

// Rendered trees, tracked so afterEach can unmount them BEFORE disconnecting the
// legacy source or clearing the action-handler/augment registries. RTL
// auto-cleanup runs after this file's afterEach, so it can't be relied on to
// unmount first — buffered.disconnect()/clearActionHandlers()/clearAugments()
// firing on a still-mounted widget is a state update outside act(), the
// documented anti-pattern in CLAUDE.md.
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

function unmountAll() {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
}

// The dynamically-resolved group `.value` reads (SAS/Gear/AG1/...) stay on the
// legacy `data` source: their mapped topics (`vessel.control.*` /
// `vessel.state.*`) are deliberately NOT carried by the stream fixture below, so
// the two-arg shim falls back to this source. `t.isPaused` / `comm.connected`
// are canonical stream reads now (`time.warp.paused` / `comms.link.connected`)
// and are fed via the stream fixture instead.
const KEYS: DataKey[] = [
  { key: "v.sasValue" },
  { key: "v.rcsValue" },
  { key: "v.gearValue" },
  { key: "v.brakeValue" },
  { key: "v.lightValue" },
  { key: "v.ag1Value" },
];

describe("ActionGroupComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  let stream: ReturnType<typeof setupStreamFixture>;
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
    // Feeds the canonical `time.warp` / `comms.link` reads (isPaused /
    // commConnected). vessel.control/vessel.state are intentionally absent, so
    // the group `.value` shim read still falls back to the legacy source above.
    stream = setupStreamFixture({
      carriedChannels: ["time.warp", "comms.link"],
      pinnedUt: 10,
    });
  });

  afterEach(() => {
    unmountAll();
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
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "action-group" }}>
          <ActionGroupComponent
            config={config}
            id="action-group"
            w={size?.w ?? 6}
            h={size?.h ?? 6}
          />
        </DashboardItemContext.Provider>
      </stream.Provider>,
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

  it("shows ON when the group value is true", async () => {
    renderGroup({ actionGroupId: "SAS" });
    act(() => {
      source.emit("v.sasValue", true);
      stream.emit("comms.link", { connected: true });
      stream.emit("time.warp", { paused: false });
    });
    expect(await screen.findByText("ON")).toBeInTheDocument();
  });

  it("surfaces the Paused unavailability notice when the game is paused", async () => {
    renderGroup({ actionGroupId: "SAS" }, { w: 6, h: 6 });
    act(() => {
      source.emit("v.sasValue", true);
      stream.emit("time.warp", { paused: true });
      stream.emit("comms.link", { connected: true });
    });
    expect(await screen.findByText("Paused")).toBeInTheDocument();
  });

  it("surfaces the No signal unavailability notice when comm is disconnected", async () => {
    renderGroup({ actionGroupId: "SAS" }, { w: 6, h: 6 });
    act(() => {
      source.emit("v.sasValue", false);
      stream.emit("time.warp", { paused: false });
      stream.emit("comms.link", { connected: false });
    });
    expect(await screen.findByText("No signal")).toBeInTheDocument();
  });

  it("suppresses the unavailability notice in the tiny size bucket (w<5)", () => {
    // At 3×4 the widget is in the tiny bucket — UnavailableNotice must not render.
    renderGroup({ actionGroupId: "SAS" }, { w: 3, h: 4 });
    act(() => {
      source.emit("v.sasValue", false);
      stream.emit("time.warp", { paused: true });
      stream.emit("comms.link", { connected: false });
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

  describe("augment slots", () => {
    beforeEach(() => clearAugments());
    // Unmount before clearAugments() notifies the augment registry's
    // subscribers, else a still-mounted AugmentSlot re-renders outside act()
    // (CLAUDE.md → Testing Philosophy, act() warning pattern).
    afterEach(() => {
      unmountAll();
      clearAugments();
    });

    // Renders the slot props so the test proves the parent's group context
    // flows through to the augment, not merely that it mounted.
    function TestBadge({ groupId, stateLabel }: ActionGroupSlotContext) {
      return (
        <span>
          badge:{groupId}:{stateLabel}
        </span>
      );
    }
    function TestSection({ groupId }: ActionGroupSlotContext) {
      return <span>section:{groupId}</span>;
    }

    it("renders the widget with both slots empty when no augment is bound", () => {
      renderGroup({ actionGroupId: "SAS" });
      act(() => {
        source.emit("v.sasValue", false);
      });
      // Widget renders normally; the empty slots contribute nothing.
      expect(
        screen.getByRole("button", { name: /toggle sas/i }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/^badge:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^section:/)).not.toBeInTheDocument();
    });

    it("renders a badge augment inline, passing the live group context", () => {
      registerAugment<"action-group.badges">({
        id: "test-ag-badge",
        augments: "action-group.badges",
        component: TestBadge,
      });
      renderGroup({ actionGroupId: "SAS" });
      act(() => {
        source.emit("v.sasValue", true);
      });
      expect(screen.getByText("badge:SAS:ON")).toBeInTheDocument();
    });

    it("renders a sections augment in the body with the group id", () => {
      registerAugment<"action-group.sections">({
        id: "test-ag-section",
        augments: "action-group.sections",
        component: TestSection,
      });
      renderGroup({ actionGroupId: "Gear" });
      act(() => {
        source.emit("v.gearValue", false);
      });
      expect(screen.getByText("section:Gear")).toBeInTheDocument();
    });
  });
});
