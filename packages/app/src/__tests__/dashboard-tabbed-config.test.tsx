/**
 * Integration test for the tabbed config modal introduced in Phase 3.
 * Renders the Dashboard with a fake component that has both a config UI
 * and actions, opens the gear modal, and verifies that switching tabs +
 * saving from each side persists the right shape in localStorage.
 */

import type { ActionDefinition } from "@ksp-gonogo/core";
import { clearRegistry, registerComponent } from "@ksp-gonogo/core";
import { CpuRegistryProvider, CpuRegistryService } from "@ksp-gonogo/data";
import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import { ModalProvider } from "@ksp-gonogo/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Dashboard,
  type DashboardConfig,
  type DashboardItem,
} from "../components/Dashboard";
import { useDashboardState } from "../components/Dashboard/useDashboardState";

function DashboardHarness({
  config,
  storageKey,
}: {
  config: DashboardConfig;
  storageKey: string;
}) {
  const s = useDashboardState(storageKey, config);
  return (
    <Dashboard
      items={s.items}
      layouts={s.layouts}
      currentLayouts={s.currentLayouts}
      breakpoint={s.breakpoint}
      onLayoutChange={s.handleLayoutChange}
      onBreakpointChange={s.handleBreakpointChange}
      updateItemConfig={s.updateItemConfig}
      updateItemMappings={s.updateItemMappings}
      updateItemMobileWidth={s.updateItemMobileWidth}
      updateItemMobileHeight={s.updateItemMobileHeight}
      removeItem={s.removeItem}
      moveItemUp={s.moveItemUp}
      moveItemDown={s.moveItemDown}
    />
  );
}

function renderWithProviders(
  service: SerialDeviceService,
  tree: React.ReactNode,
) {
  // Match the real app's provider order: ModalProvider sits ABOVE the
  // screen-level providers. If the harness inverted this, modal-portal
  // content would see those contexts for free and we'd never notice when
  // GearButton forgets to re-provide them.
  const cpuRegistry = new CpuRegistryService("main");
  return render(
    <ModalProvider>
      <SerialDeviceProvider service={service}>
        <CpuRegistryProvider service={cpuRegistry}>{tree}</CpuRegistryProvider>
      </SerialDeviceProvider>
    </ModalProvider>,
  );
}

function makeEmptyService(): SerialDeviceService {
  return new SerialDeviceService({
    screenKey: `test-${Math.random().toString(36).slice(2)}`,
    renderDebounceMs: 0,
  });
}

const actions = [
  { id: "toggle", label: "Toggle", accepts: ["button"] },
] as const satisfies readonly ActionDefinition[];

function FakeConfig({
  config,
  onSave,
}: {
  config: { label?: string };
  onSave: (c: { label?: string }) => void;
}) {
  const [value, setValue] = useState(config.label ?? "");
  return (
    <div>
      <label htmlFor="fake-label">Label</label>
      <input
        id="fake-label"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="button" onClick={() => onSave({ label: value })}>
        save-config
      </button>
    </div>
  );
}

function FakeComponent({ config }: { config?: { label?: string } }) {
  return <div data-testid="fake-label">{config?.label ?? "-"}</div>;
}

function registerFakeWithConfigAndActions() {
  registerComponent({
    id: "fake-both",
    name: "Fake",
    description: "fake",
    tags: [],
    component: FakeComponent,
    configComponent: FakeConfig,
    actions,
    defaultConfig: { label: "" },
  });
}

const STORAGE_KEY = "gonogo.dashboard.test";

const CONFIG: DashboardConfig = {
  items: [{ i: "w1", componentId: "fake-both" } satisfies DashboardItem],
  layouts: { lg: [{ i: "w1", x: 0, y: 0, w: 3, h: 3 }] },
};

beforeEach(() => {
  clearRegistry();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("Dashboard tabbed config modal", () => {
  it("opens tabs when a component has both a configComponent and actions", () => {
    registerFakeWithConfigAndActions();
    renderWithProviders(
      makeEmptyService(),
      <DashboardHarness config={CONFIG} storageKey={STORAGE_KEY} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /configure fake/i }));

    expect(screen.getByRole("tab", { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /inputs/i })).toBeInTheDocument();
  });

  it("persists config from the Settings tab into localStorage", () => {
    registerFakeWithConfigAndActions();
    renderWithProviders(
      makeEmptyService(),
      <DashboardHarness config={CONFIG} storageKey={STORAGE_KEY} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /configure fake/i }));
    // Settings tab is active by default when a configComponent exists.
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "ALPHA" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save-config/i }));

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(persisted.items[0].config).toEqual({ label: "ALPHA" });
  });

  it("persists a real inputMapping round-trip when saving from the Inputs tab", async () => {
    registerFakeWithConfigAndActions();
    const service = makeEmptyService();
    for (const d of service.getDevices()) await service.removeDevice(d.id);
    for (const t of service.getDeviceTypes())
      await service.removeDeviceType(t.id);
    service.upsertDeviceType({
      id: "panel",
      name: "Panel",
      parser: "char-position",
      inputs: [{ id: "btnA", name: "A", kind: "button" }],
    });
    service.addDevice({
      id: "panel-1",
      name: "Panel 1",
      typeId: "panel",
      transport: "virtual",
    });

    const { unmount } = renderWithProviders(
      service,
      <DashboardHarness config={CONFIG} storageKey={STORAGE_KEY} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /configure fake/i }));
    fireEvent.click(screen.getByRole("tab", { name: /inputs/i }));
    fireEvent.change(screen.getByLabelText("Toggle"), {
      target: { value: "panel-1::btnA" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(persisted.items[0].inputMappings).toEqual({
      toggle: { deviceId: "panel-1", inputId: "btnA" },
    });

    // Reload — new Dashboard instance sees the persisted mapping.
    unmount();
    renderWithProviders(
      service,
      <DashboardHarness config={CONFIG} storageKey={STORAGE_KEY} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /configure fake/i }));
    fireEvent.click(screen.getByRole("tab", { name: /inputs/i }));
    expect((screen.getByLabelText("Toggle") as HTMLSelectElement).value).toBe(
      "panel-1::btnA",
    );
  });

  it("persists inputMappings (empty) when saving from the Inputs tab", () => {
    registerFakeWithConfigAndActions();
    renderWithProviders(
      makeEmptyService(),
      <DashboardHarness config={CONFIG} storageKey={STORAGE_KEY} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /configure fake/i }));
    fireEvent.click(screen.getByRole("tab", { name: /inputs/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(persisted.items[0].inputMappings).toEqual({});
  });

  it("shows only the Settings UI when a component has no actions", () => {
    registerComponent({
      id: "fake-config-only",
      name: "Fake CfgOnly",
      description: "",
      tags: [],
      component: FakeComponent,
      configComponent: FakeConfig,
    });
    renderWithProviders(
      makeEmptyService(),
      <DashboardHarness
        config={{
          items: [{ i: "w1", componentId: "fake-config-only" }],
          layouts: { lg: [{ i: "w1", x: 0, y: 0, w: 3, h: 3 }] },
        }}
        storageKey={STORAGE_KEY}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /configure fake cfgonly/i }),
    );

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Label")).toBeInTheDocument();
  });

  it("shows only the Inputs UI when a component has actions but no configComponent", () => {
    registerComponent({
      id: "fake-actions-only",
      name: "Fake ActionsOnly",
      description: "",
      tags: [],
      component: FakeComponent,
      actions,
    });
    renderWithProviders(
      makeEmptyService(),
      <DashboardHarness
        config={{
          items: [{ i: "w1", componentId: "fake-actions-only" }],
          layouts: { lg: [{ i: "w1", x: 0, y: 0, w: 3, h: 3 }] },
        }}
        storageKey={STORAGE_KEY}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /configure fake actionsonly/i }),
    );

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByText(/Toggle/)).toBeInTheDocument();
  });
});
