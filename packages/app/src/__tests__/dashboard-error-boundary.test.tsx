/**
 * When a registered widget throws during render, Dashboard wraps each cell
 * in an ErrorBoundary so the rest of the dashboard keeps working. The
 * fallback UI surfaces the error and offers a Retry button. Pinned here
 * because the boundary lives across the Grid/Mobile split — both paths
 * share the same WidgetError fallback.
 */

import { clearRegistry, registerComponent } from "@gonogo/core";
import { CpuRegistryProvider, CpuRegistryService } from "@gonogo/data";
import { SerialDeviceProvider, SerialDeviceService } from "@gonogo/serial";
import { ModalProvider } from "@gonogo/ui";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard, type DashboardConfig } from "../components/Dashboard";
import { useDashboardState } from "../components/Dashboard/useDashboardState";

function Harness({
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
      removeItem={s.removeItem}
      moveItemUp={s.moveItemUp}
      moveItemDown={s.moveItemDown}
    />
  );
}

function renderWithProviders(tree: React.ReactNode) {
  const serialService = new SerialDeviceService({ screenKey: "test-screen" });
  const cpuRegistry = new CpuRegistryService("main");
  return render(
    <ModalProvider>
      <SerialDeviceProvider service={serialService}>
        <CpuRegistryProvider service={cpuRegistry}>{tree}</CpuRegistryProvider>
      </SerialDeviceProvider>
    </ModalProvider>,
  );
}

describe("Dashboard widget error boundary", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearRegistry();
    localStorage.clear();
    // React logs the caught error to console.error; silence to keep the
    // test output clean.
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    consoleErrorSpy.mockRestore();
  });

  it("renders the WidgetError fallback when a widget throws", () => {
    function Boom(): React.ReactElement {
      throw new Error("kaboom");
    }
    registerComponent({
      id: "boomer",
      name: "Boomer",
      description: "throws",
      tags: [],
      component: Boom,
      dataRequirements: [],
      defaultSize: { w: 3, h: 3 },
    });

    renderWithProviders(
      <Harness
        storageKey="test-error-boundary"
        config={{
          items: [{ i: "x", componentId: "boomer" }],
          layouts: { lg: [{ i: "x", x: 0, y: 0, w: 3, h: 3 }] },
        }}
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Boomer crashed/)).toBeInTheDocument();
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("Retry resets the boundary so a now-healthy widget renders", async () => {
    let shouldThrow = true;
    function Toggleable() {
      if (shouldThrow) throw new Error("first render boom");
      return <div data-testid="ok">healthy</div>;
    }
    registerComponent({
      id: "togglable",
      name: "Togglable",
      description: "throws once",
      tags: [],
      component: Toggleable,
      dataRequirements: [],
      defaultSize: { w: 3, h: 3 },
    });

    renderWithProviders(
      <Harness
        storageKey="test-error-boundary-retry"
        config={{
          items: [{ i: "x", componentId: "togglable" }],
          layouts: { lg: [{ i: "x", x: 0, y: 0, w: 3, h: 3 }] },
        }}
      />,
    );

    expect(screen.getByText(/Togglable crashed/)).toBeInTheDocument();
    shouldThrow = false;
    screen.getByRole("button", { name: /retry/i }).click();
    expect(await screen.findByTestId("ok")).toBeInTheDocument();
  });
});
