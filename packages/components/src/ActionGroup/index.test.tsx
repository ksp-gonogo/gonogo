import {
  clearActionHandlers,
  clearAugments,
  clearRegistry,
  DashboardItemContext,
  registerAugment,
} from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  ActionGroupComponent,
  type ActionGroupConfig,
  type ActionGroupSlotContext,
} from "./index";

// Unmounted before the registries clear, so the clear never updates a mounted tree outside act().
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

describe("ActionGroupComponent", () => {
  let fixture: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    clearRegistry();
    fixture = setupStreamFixture({
      carriedChannels: [
        "vessel.control",
        "vessel.structure",
        "time.warp",
        "comms.link",
      ],
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    unmountAll();
    clearActionHandlers();
  });

  /** Emits a `vessel.control` payload carrying `patch`, with stock's ten custom groups present as the mod sends them. */
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
    config: ActionGroupConfig = { actionGroupId: "SAS" },
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
    renderGroup({
      // @ts-expect-error: the placeholder path needs a config whose group id
      // never arrived, and `ActionGroupConfig` says that cannot happen
      actionGroupId: undefined,
    });
    expect(screen.getByText("No action group configured")).toBeInTheDocument();
  });

  it("shows the NULL_DISPLAY unknown indicator before telemetry arrives", () => {
    renderGroup({ actionGroupId: "SAS" });
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
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
    expect(await screen.findByText("Chutes")).toBeInTheDocument();
    await waitFor(() => expect(visibleText()).toContain("AG1"));
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
    // Wait for the content: the pill renders before any value arrives.
    await waitFor(() => expect(pill).toHaveTextContent("OFF"));
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
    await screen.findByText("OFF");
    await user.click(screen.getByRole("button", { name: /toggle sas/i }));
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "vessel.control.setSas",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ enabled: true });
    });
  });

  it("fires the stage command unconditionally, with no value invert", async () => {
    const user = userEvent.setup();
    renderGroup({ actionGroupId: "Stage" }, { w: 3, h: 3 });
    act(() => {
      fixture.emit("vessel.structure", { currentStage: 4 });
    });
    await screen.findByText("4");
    await user.click(screen.getByRole("button", { name: /toggle stage/i }));
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "vessel.control.stage",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toBeNull();
    });
  });

  it("fires the AGX setActionGroup command keyed by index, not name", async () => {
    const user = userEvent.setup();
    renderGroup({ actionGroupId: "AG3" }, { w: 3, h: 3 });
    emitControl({
      actionGroups: [{ index: 3, name: "AG3", state: true }],
    });
    await screen.findByText("ON");
    await user.click(screen.getByRole("button", { name: /toggle ag3/i }));
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "vessel.control.setActionGroup",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ group: 3, state: false });
    });
  });

  it("does not dispatch a toggle while the current value is still unknown", async () => {
    const user = userEvent.setup();
    renderGroup({ actionGroupId: "SAS" }, { w: 3, h: 3 });
    await user.click(screen.getByRole("button", { name: /toggle sas/i }));
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === "vessel.control.setSas",
      ),
    ).toBeUndefined();
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
    // The emitted frame lands a microtask later, so settle on it before axe or it re-renders mid-scan outside act().
    await screen.findByText("ON");
    expect(await axe(container)).toHaveNoViolations();
  });

  describe("augment slots", () => {
    beforeEach(() => clearAugments());
    // Unmount first, else clearAugments() re-renders a mounted AugmentSlot outside act().
    afterEach(() => {
      unmountAll();
      clearAugments();
    });

    // Renders the slot props, proving the group context reaches the augment.
    function TestSection({ groupId }: ActionGroupSlotContext) {
      return <span>section:{groupId}</span>;
    }

    it("renders the widget with the sections slot empty when no augment is bound", async () => {
      renderGroup({ actionGroupId: "SAS" });
      emitControl({ sas: false });
      expect(
        screen.getByRole("button", { name: /toggle sas/i }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/^section:/)).not.toBeInTheDocument();
    });

    it("renders a sections augment in the body with the group id", async () => {
      registerAugment<"action-group.subsystem">({
        id: "test-ag-section",
        augments: "action-group.subsystem",
        component: TestSection,
      });
      renderGroup({ actionGroupId: "Gear" });
      emitControl({ gear: false });
      expect(await screen.findByText("section:Gear")).toBeInTheDocument();
    });
  });
});
