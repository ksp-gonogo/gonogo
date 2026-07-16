/**
 * When a registered widget throws during render, Dashboard wraps each cell
 * in an ErrorBoundary so the rest of the dashboard keeps working. The
 * fallback UI surfaces the error and offers a Retry button. Pinned here
 * because the boundary lives across the Grid/Mobile split — both paths
 * share the same WidgetError fallback.
 */

import { clearRegistry, registerComponent } from "@ksp-gonogo/core";
import { CpuRegistryProvider, CpuRegistryService } from "@ksp-gonogo/data";
import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import { ModalProvider } from "@ksp-gonogo/ui";
import { render, screen } from "@testing-library/react";
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
      updateItemMobileWidth={s.updateItemMobileWidth}
      updateItemMobileHeight={s.updateItemMobileHeight}
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
  // React 18 surfaces caught errors two ways: a `console.error(...)` call
  // *and* an `error` event dispatched on the jsdom window. The console
  // spy silences the first; jsdom's default "error" handler logs the
  // second to stderr (that's the bare stack trace that keeps showing
  // up in passing-test output). preventDefault on the event tells jsdom
  // to skip its default handler. We're testing that the boundary catches
  // and renders a fallback — the fact that React also fires an event
  // about it is incidental noise, not a real failure.
  const suppressErrorEvent = (e: ErrorEvent) => e.preventDefault();

  beforeEach(() => {
    clearRegistry();
    localStorage.clear();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    window.addEventListener("error", suppressErrorEvent);
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
    window.removeEventListener("error", suppressErrorEvent);
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
