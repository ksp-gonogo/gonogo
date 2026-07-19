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
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
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

/**
 * The widget no longer READS anything off the legacy `data` source. Its group
 * values come off the canonical `vessel.control` / `vessel.structure` stream
 * (the `useTelemetry("data", group.value)` shim is gone — see `emitControl`),
 * and `isPaused` / `commConnected` are canonical stream reads too
 * (`time.warp.paused` / `comms.link.connected`). The MockDataSource below
 * survives only for the WRITE path: `useExecuteAction("data")` still dispatches
 * each group's `.toggle`, which `onExecute` records into `executed`.
 */
const KEYS: DataKey[] = [];

describe("ActionGroupComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  let executed: string[];
  let fixture: ReturnType<typeof setupStreamFixture>;

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
    // Every read this widget makes is canonical now: the group values off
    // `vessel.control` / `vessel.structure`, and isPaused / commConnected off
    // `time.warp` / `comms.link`. Nothing falls back to the legacy source.
    fixture = setupStreamFixture({
      carriedChannels: [
        "vessel.control",
        "vessel.structure",
        "time.warp",
        "comms.link",
      ],
      pinnedUt: 10,
    });
  });

  afterEach(() => {
    unmountAll();
    buffered.disconnect();
    clearActionHandlers();
  });

  /**
   * Emits a `vessel.control` payload carrying `patch`. Stock's ten customs are
   * always present (all off unless `patch.actionGroups` overrides) so the
   * registry's derived half exists, mirroring what the mod actually sends.
   */
  function emitControl(patch: Record<string, unknown>) {
    act(() => {
      fixture.emit("vessel.control", {
        sasMode: 0,
        throttle: 0,
        actionGroups: Array.from({ length: 10 }, (_, i) => ({
          index: i + 1,
          name: `AG${i + 1}`,
          state: false,
        })),
        ...patch,
      });
    });
  }

  function renderGroup(
    config: { actionGroupId?: string; label?: string } = {
      actionGroupId: "SAS",
    },
    size?: { w?: number; h?: number },
  ) {
    return render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "action-group" }}>
          <ActionGroupComponent
            config={config}
            id="action-group"
            w={size?.w ?? 6}
            h={size?.h ?? 6}
          />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
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

  it("shows OFF when the group value is false", async () => {
    renderGroup({ actionGroupId: "SAS" });
    emitControl({ sas: false });
    expect(await screen.findByText("OFF")).toBeInTheDocument();
  });

  it("shows ON when the group value is true", async () => {
    renderGroup({ actionGroupId: "SAS" });
    emitControl({ sas: true });
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("time.warp", { paused: false });
    });
    expect(await screen.findByText("ON")).toBeInTheDocument();
  });

  it("surfaces the Paused unavailability notice when the game is paused", async () => {
    renderGroup({ actionGroupId: "SAS" }, { w: 6, h: 6 });
    emitControl({ sas: true });
    act(() => {
      fixture.emit("time.warp", { paused: true });
      fixture.emit("comms.link", { connected: true });
    });
    expect(await screen.findByText("Paused")).toBeInTheDocument();
  });

  it("surfaces the No signal unavailability notice when comm is disconnected", async () => {
    renderGroup({ actionGroupId: "SAS" }, { w: 6, h: 6 });
    emitControl({ sas: false });
    act(() => {
      fixture.emit("time.warp", { paused: false });
      fixture.emit("comms.link", { connected: false });
    });
    expect(await screen.findByText("No signal")).toBeInTheDocument();
  });

  it("suppresses the unavailability notice in the tiny size bucket (w<5)", async () => {
    // At 3×4 the widget is in the tiny bucket — UnavailableNotice must not render.
    renderGroup({ actionGroupId: "SAS" }, { w: 3, h: 4 });
    emitControl({ sas: false });
    act(() => {
      fixture.emit("time.warp", { paused: true });
      fixture.emit("comms.link", { connected: false });
    });
    expect(screen.queryByText("Paused")).not.toBeInTheDocument();
    expect(screen.queryByText("No signal")).not.toBeInTheDocument();
  });

  it("shows the custom label when one is configured", async () => {
    renderGroup({ actionGroupId: "AG1", label: "Chutes" });
    emitControl({ actionGroups: [{ index: 1, name: "AG1", state: true }] });
    expect(await screen.findByText("Chutes")).toBeInTheDocument();
  });

  it("shows the official group name as secondary when a custom label is set (cols≥5)", async () => {
    renderGroup({ actionGroupId: "AG1", label: "Chutes" }, { w: 6, h: 6 });
    emitControl({ actionGroups: [{ index: 1, name: "AG1", state: false }] });
    // OfficialName = "AG1", custom label = "Chutes"; at cols=6 both visible
    expect(await screen.findByText("Chutes")).toBeInTheDocument();
    expect(await screen.findByText("AG1")).toBeInTheDocument();
  });

  it("reads the correct value key for non-SAS groups (Gear)", async () => {
    renderGroup({ actionGroupId: "Gear" });
    emitControl({ gear: true });
    expect(await screen.findByText("ON")).toBeInTheDocument();
  });

  it("renders the state pill as a toggle button at the minimum 3×3 size", async () => {
    renderGroup({ actionGroupId: "SAS" }, { w: 3, h: 3 });
    emitControl({ sas: false });
    const pill = await screen.findByRole("button", { name: /toggle sas/i });
    expect(pill).toHaveTextContent("OFF");
    expect(pill).not.toBeDisabled();
  });

  it("reflects ON state via aria-pressed on the pill button", async () => {
    renderGroup({ actionGroupId: "SAS" });
    emitControl({ sas: true });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle sas/i }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("fires the group toggle action when the pill button is clicked", async () => {
    const user = userEvent.setup();
    renderGroup({ actionGroupId: "SAS" }, { w: 3, h: 3 });
    emitControl({ sas: false });
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
    emitControl({ sas: true });
    // Let the emitted frame settle BEFORE axe runs. `emitControl` delivers on a
    // deferred `beginFrame` (a `queueMicrotask` under jsdom — see
    // `setupStreamFixture`/`scheduleFrame`), so the render reflecting `sas:true`
    // lands one microtask after the sync `act()` returns. Every other test here
    // follows the emit with an RTL `findBy`/`waitFor`, which polls with the
    // act-environment OFF and quietly absorbs that frame; this test alone went
    // straight into `axe()`, whose long scan runs with the act-environment ON
    // but no `act()` on the stack — so the deferred frame re-rendered
    // `ActionGroupComponent` mid-scan, outside act (the load-dependent
    // "not wrapped in act" warning). Settling on the rendered state first — the
    // same guard the Navball/FleetComms axe tests use — drains it cleanly.
    await screen.findByText("ON");
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

    it("renders the widget with both slots empty when no augment is bound", async () => {
      renderGroup({ actionGroupId: "SAS" });
      emitControl({ sas: false });
      // Widget renders normally; the empty slots contribute nothing.
      expect(
        screen.getByRole("button", { name: /toggle sas/i }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/^badge:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^section:/)).not.toBeInTheDocument();
    });

    it("renders a badge augment inline, passing the live group context", async () => {
      registerAugment<"action-group.badges">({
        id: "test-ag-badge",
        augments: "action-group.badges",
        component: TestBadge,
      });
      renderGroup({ actionGroupId: "SAS" });
      emitControl({ sas: true });
      expect(await screen.findByText("badge:SAS:ON")).toBeInTheDocument();
    });

    it("renders a sections augment in the body with the group id", async () => {
      registerAugment<"action-group.sections">({
        id: "test-ag-section",
        augments: "action-group.sections",
        component: TestSection,
      });
      renderGroup({ actionGroupId: "Gear" });
      emitControl({ gear: false });
      expect(await screen.findByText("section:Gear")).toBeInTheDocument();
    });
  });
});
