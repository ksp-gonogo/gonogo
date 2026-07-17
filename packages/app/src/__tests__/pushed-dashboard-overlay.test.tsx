import {
  type ComponentDefinition,
  clearRegistry,
  registerComponent,
  useActionInput,
  useDashboardItemId,
} from "@ksp-gonogo/core";
import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PushedDashboardOverlay } from "../pushToMain/PushedDashboardOverlay";
import { PushHostProvider } from "../pushToMain/PushHostContext";
import type {
  PushedWidget,
  PushHostService,
} from "../pushToMain/PushHostService";

function MiniWidget({
  config,
}: {
  id?: string;
  config?: { label?: string };
  w?: number;
  h?: number;
}) {
  return <div>mini widget: {config?.label ?? "no-label"}</div>;
}

function registerMini() {
  registerComponent({
    id: "mini",
    name: "Mini",
    description: "Test widget",
    tags: [],
    component: MiniWidget,
    dataRequirements: [],
    behaviors: [],
    defaultConfig: {},
  } as unknown as ComponentDefinition);
}

function makeFakeHost(initial: PushedWidget[]): PushHostService {
  const widgets = [...initial];
  const listeners = new Set<(w: PushedWidget[]) => void>();
  const dismiss = vi.fn((peerId: string, widgetInstanceId: string) => {
    const before = widgets.length;
    const idx = widgets.findIndex(
      (w) => w.peerId === peerId && w.widgetInstanceId === widgetInstanceId,
    );
    if (idx !== -1) widgets.splice(idx, 1);
    if (widgets.length !== before) {
      for (const cb of listeners) cb([...widgets]);
    }
  });
  return {
    snapshot: () => [...widgets],
    onChange: (cb: (w: PushedWidget[]) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dismiss,
  } as unknown as PushHostService;
}

describe("PushedDashboardOverlay", () => {
  beforeEach(() => {
    // Clear at the START of each test, not in an afterEach: Testing Library's
    // auto-cleanup unmounts AFTER any file-level afterEach, so clearing on
    // teardown would re-render a still-mounted overlay (an out-of-act update).
    clearRegistry();
  });

  it("renders nothing when the pushed list is empty", () => {
    const host = makeFakeHost([]);
    const { container } = render(
      <PushHostProvider service={host}>
        <PushedDashboardOverlay />
      </PushHostProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("mounts the registered component for each pushed widget", () => {
    registerMini();
    const host = makeFakeHost([
      {
        peerId: "peer-A",
        widgetInstanceId: "w1",
        componentId: "mini",
        config: { label: "Alpha" },
        width: 4,
        height: 3,
        stationName: "LDO",
      },
      {
        peerId: "peer-B",
        widgetInstanceId: "w2",
        componentId: "mini",
        config: { label: "Bravo" },
        width: 3,
        height: 3,
        stationName: "FIDO",
      },
    ]);
    render(
      <PushHostProvider service={host}>
        <PushedDashboardOverlay />
      </PushHostProvider>,
    );
    expect(screen.getByText("mini widget: Alpha")).toBeInTheDocument();
    expect(screen.getByText("mini widget: Bravo")).toBeInTheDocument();
    expect(screen.getByText("LDO")).toBeInTheDocument();
    expect(screen.getByText("FIDO")).toBeInTheDocument();
    expect(screen.getByText(/2 widgets/)).toBeInTheDocument();
  });

  it("dismiss button calls host.dismiss with the right key", async () => {
    registerMini();
    const widgets: PushedWidget[] = [
      {
        peerId: "peer-A",
        widgetInstanceId: "w1",
        componentId: "mini",
        config: {},
        width: 4,
        height: 3,
        stationName: "LDO",
      },
    ];
    const host = makeFakeHost(widgets);
    render(
      <PushHostProvider service={host}>
        <PushedDashboardOverlay />
      </PushHostProvider>,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Dismiss pushed widget" }),
    );
    await waitFor(() => {
      expect(
        screen.queryByText("mini widget: no-label"),
      ).not.toBeInTheDocument();
    });
    expect(host.dismiss).toHaveBeenCalledWith("peer-A", "w1");
  });

  it("provides DashboardItemContext so pushed widgets can call useActionInput without crashing", () => {
    // Regression: MapView / ActionGroup etc. read useDashboardItemId through
    // useActionInput. Without the context wrapper, pushing them from a
    // station threw on the main screen.
    const ACTIONS = [
      { id: "toggle", label: "Toggle", accepts: ["button"] as const },
    ] as const;
    function ContextDependentWidget() {
      const instanceId = useDashboardItemId();
      useActionInput<typeof ACTIONS>({ toggle: () => {} });
      return <div data-testid="ctxid">{instanceId}</div>;
    }
    registerComponent({
      id: "ctx-widget",
      name: "Ctx widget",
      description: "",
      tags: [],
      component: ContextDependentWidget,
      dataRequirements: [],
      behaviors: [],
      defaultConfig: {},
      actions: ACTIONS,
    } as unknown as ComponentDefinition);

    const host = makeFakeHost([
      {
        peerId: "peer-A",
        widgetInstanceId: "ctx-1",
        componentId: "ctx-widget",
        config: {},
        width: 4,
        height: 3,
        stationName: "LDO",
      },
    ]);
    render(
      <PushHostProvider service={host}>
        <PushedDashboardOverlay />
      </PushHostProvider>,
    );
    expect(screen.getByTestId("ctxid").textContent).toBe("ctx-1");
  });

  it("shows a fallback when the pushed componentId isn't registered on main", () => {
    const host = makeFakeHost([
      {
        peerId: "peer-A",
        widgetInstanceId: "w1",
        componentId: "missing-component",
        config: {},
        width: 4,
        height: 3,
        stationName: "LDO",
      },
    ]);
    render(
      <PushHostProvider service={host}>
        <PushedDashboardOverlay />
      </PushHostProvider>,
    );
    expect(
      screen.getByText(/missing-component.*not registered/),
    ).toBeInTheDocument();
  });
});
