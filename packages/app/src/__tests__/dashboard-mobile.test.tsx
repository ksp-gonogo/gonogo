/**
 * Touch-device dashboard path: when matchMedia("(pointer: coarse)") is true
 * Dashboard renders a flex-wrap list with up/down reorder buttons rather
 * than react-grid-layout's drag handle. This file pins the substitution
 * and verifies the reorder controls mutate items[] in the expected
 * direction (with the first/last items respectively disabled).
 */

import { clearRegistry, registerComponent } from "@ksp-gonogo/core";
import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import { ModalProvider } from "@ksp-gonogo/ui";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard, type DashboardConfig } from "../components/Dashboard";
import { useDashboardState } from "../components/Dashboard/useDashboardState";

// matchMedia isn't implemented in jsdom; stub it so useTouchDevice flips
// to true. vi.unstubAllGlobals() in afterEach restores the original.
function installCoarsePointerMatchMedia() {
  const mql = {
    matches: true,
    media: "(pointer: coarse)",
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => mql),
  );
}

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
  const service = new SerialDeviceService({ screenKey: "test-screen" });
  return render(
    <ModalProvider>
      <SerialDeviceProvider service={service}>{tree}</SerialDeviceProvider>
    </ModalProvider>,
  );
}

function registerStubWidget(id: string, name: string) {
  registerComponent({
    id,
    name,
    description: name,
    tags: [],
    component: () => <div data-testid={`body-${id}`}>{name} body</div>,
    dataRequirements: [],
    defaultSize: { w: 6, h: 4 },
  });
}

describe("Dashboard — mobile / touch path", () => {
  beforeEach(() => {
    installCoarsePointerMatchMedia();
    localStorage.clear();
    clearRegistry();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders items in a list with reorder buttons (no RGL drag handle)", () => {
    registerStubWidget("alpha", "Alpha");
    registerStubWidget("beta", "Beta");

    renderWithProviders(
      <Harness
        storageKey="test-mobile-list"
        config={{
          items: [
            { i: "a", componentId: "alpha" },
            { i: "b", componentId: "beta" },
          ],
          layouts: {},
        }}
      />,
    );

    expect(screen.getByText("Alpha body")).toBeInTheDocument();
    expect(screen.getByText("Beta body")).toBeInTheDocument();

    // Two move-up buttons (one per item) — the first item's is disabled.
    const upButtons = screen.getAllByRole("button", { name: "Move up" });
    expect(upButtons).toHaveLength(2);
    expect(upButtons[0]).toBeDisabled();
    expect(upButtons[1]).not.toBeDisabled();

    const downButtons = screen.getAllByRole("button", { name: "Move down" });
    expect(downButtons).toHaveLength(2);
    expect(downButtons[0]).not.toBeDisabled();
    expect(downButtons[1]).toBeDisabled();

    // No RGL grid handle on the touch path.
    expect(document.querySelector(".react-grid-layout")).toBeNull();
  });

  it("Move down on the first item swaps it with the second", async () => {
    const user = userEvent.setup();
    registerStubWidget("alpha", "Alpha");
    registerStubWidget("beta", "Beta");

    renderWithProviders(
      <Harness
        storageKey="test-mobile-reorder"
        config={{
          items: [
            { i: "a", componentId: "alpha" },
            { i: "b", componentId: "beta" },
          ],
          layouts: {},
        }}
      />,
    );

    const downButtons = screen.getAllByRole("button", { name: "Move down" });
    await user.click(downButtons[0]);

    // Assert on the rendered cell's `data-i` rather than just DOM order:
    // if React reused positions and only swapped content, the body order
    // would lie. data-i tracks the actual item identity in each slot.
    const cells = Array.from(
      document.querySelectorAll<HTMLElement>("[data-i]"),
    );
    expect(cells.map((c) => c.dataset.i)).toEqual(["b", "a"]);
  });

  it("persists the new item order to localStorage", async () => {
    const user = userEvent.setup();
    registerStubWidget("alpha", "Alpha");
    registerStubWidget("beta", "Beta");
    const KEY = "test-mobile-persist";

    renderWithProviders(
      <Harness
        storageKey={KEY}
        config={{
          items: [
            { i: "a", componentId: "alpha" },
            { i: "b", componentId: "beta" },
          ],
          layouts: {},
        }}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: "Move down" })[0]);

    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as {
      items: Array<{ i: string }>;
    };
    expect(stored.items.map((it) => it.i)).toEqual(["b", "a"]);
  });

  it("plumbs mobileWidth onto the rendered cell so half widgets pair", () => {
    registerComponent({
      id: "compact",
      name: "Compact",
      description: "compact",
      tags: [],
      component: () => <div data-testid="compact-body">compact</div>,
      dataRequirements: [],
      defaultSize: { w: 6, h: 6 },
      mobileWidth: "half",
    });

    renderWithProviders(
      <Harness
        storageKey="test-mobile-half"
        config={{
          items: [{ i: "c1", componentId: "compact" }],
          layouts: {},
        }}
      />,
    );

    const cell = screen
      .getByTestId("compact-body")
      .closest("[data-mobile-width]");
    expect(cell).not.toBeNull();
    expect(cell?.getAttribute("data-mobile-width")).toBe("half");
  });

  it("toggle button flips a full widget to half (and back), persisting the override", async () => {
    const user = userEvent.setup();
    registerStubWidget("alpha", "Alpha");
    const KEY = "test-mobile-width-toggle";

    renderWithProviders(
      <Harness
        storageKey={KEY}
        config={{
          items: [{ i: "a", componentId: "alpha" }],
          layouts: {},
        }}
      />,
    );

    // Default: full (no item override, no def override).
    const cell = screen
      .getByTestId("body-alpha")
      .closest("[data-mobile-width]");
    expect(cell?.getAttribute("data-mobile-width")).toBe("full");

    await user.click(
      screen.getByRole("button", { name: "Shrink to half width" }),
    );
    expect(cell?.getAttribute("data-mobile-width")).toBe("half");

    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as {
      items: Array<{ i: string; mobileWidth?: string }>;
    };
    expect(stored.items[0].mobileWidth).toBe("half");

    // Round-trip: half → full label switches.
    await user.click(
      screen.getByRole("button", { name: "Expand to full width" }),
    );
    expect(cell?.getAttribute("data-mobile-width")).toBe("full");
  });

  it("height toggle button flips a full widget to half (and back), persisting the override", async () => {
    const user = userEvent.setup();
    registerStubWidget("alpha", "Alpha");
    const KEY = "test-mobile-height-toggle";

    renderWithProviders(
      <Harness
        storageKey={KEY}
        config={{
          items: [{ i: "a", componentId: "alpha" }],
          layouts: {},
        }}
      />,
    );

    const cell = screen
      .getByTestId("body-alpha")
      .closest("[data-mobile-height]");
    const fullHeight = Number(cell?.getAttribute("data-mobile-height") ?? "0");
    expect(fullHeight).toBeGreaterThan(0);

    await user.click(
      screen.getByRole("button", { name: "Shrink to half height" }),
    );
    const halfHeight = Number(cell?.getAttribute("data-mobile-height") ?? "0");
    expect(halfHeight).toBe(Math.round(fullHeight / 2));

    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as {
      items: Array<{ i: string; mobileHeight?: string }>;
    };
    expect(stored.items[0].mobileHeight).toBe("half");

    await user.click(
      screen.getByRole("button", { name: "Expand to full height" }),
    );
    const restored = Number(cell?.getAttribute("data-mobile-height") ?? "0");
    expect(restored).toBe(fullHeight);
  });

  it("per-instance mobileWidth on the item overrides the component default", () => {
    // Component default is "half" — instance override forces it back to "full".
    registerComponent({
      id: "compact",
      name: "Compact",
      description: "compact",
      tags: [],
      component: () => <div data-testid="compact-body">compact</div>,
      dataRequirements: [],
      defaultSize: { w: 6, h: 6 },
      mobileWidth: "half",
    });

    renderWithProviders(
      <Harness
        storageKey="test-mobile-width-override"
        config={{
          items: [{ i: "c1", componentId: "compact", mobileWidth: "full" }],
          layouts: {},
        }}
      />,
    );

    const cell = screen
      .getByTestId("compact-body")
      .closest("[data-mobile-width]");
    expect(cell?.getAttribute("data-mobile-width")).toBe("full");
  });

  it("plumbs mobileHeight override (and falls back to defaultSize.h * 25 when absent)", () => {
    registerComponent({
      id: "tall",
      name: "Tall",
      description: "tall",
      tags: [],
      component: () => <div data-testid="tall-body">tall</div>,
      dataRequirements: [],
      defaultSize: { w: 6, h: 6 },
      mobileHeight: 320,
    });
    registerComponent({
      id: "default-h",
      name: "DefaultH",
      description: "default",
      tags: [],
      component: () => <div data-testid="default-body">default</div>,
      dataRequirements: [],
      defaultSize: { w: 6, h: 4 },
    });

    renderWithProviders(
      <Harness
        storageKey="test-mobile-height"
        config={{
          items: [
            { i: "t", componentId: "tall" },
            { i: "d", componentId: "default-h" },
          ],
          layouts: {},
        }}
      />,
    );

    const tallCell = screen
      .getByTestId("tall-body")
      .closest("[data-mobile-height]");
    expect(tallCell?.getAttribute("data-mobile-height")).toBe("320");

    // Fallback: defaultSize.h (4) * ROW_HEIGHT (25) = 100.
    const defaultCell = screen
      .getByTestId("default-body")
      .closest("[data-mobile-height]");
    expect(defaultCell?.getAttribute("data-mobile-height")).toBe("100");
  });
});
