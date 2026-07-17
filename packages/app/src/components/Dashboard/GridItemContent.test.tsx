/*
 * Structural guard: verify that all widget action buttons (Remove, Configure)
 * live inside a .widget-action-buttons container, which is the draggableCancel
 * target in GridDashboard. If the class or wrapper is ever removed, the touch
 * drag regression returns -- this test catches that drift.
 *
 * Note: react-draggable attaches onTouchStart via addEventListener({passive:false}),
 * bypassing React's synthetic event system. stopPropagation on mouse events is
 * not sufficient for touch. The actual drag-start hit-test is not reproducible
 * in jsdom; this test guards the selector contract instead.
 */
import {
  type ComponentProps,
  clearRegistry,
  registerComponent,
} from "@ksp-gonogo/core";
import { render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GridItemContent } from "./GridItemContent";
import type { DashboardItem } from "./index";

/* Stub context hooks and heavy dependencies pulled in transitively. */
vi.mock("@ksp-gonogo/components", () => ({
  RequiresGuard: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../../pushToMain/PushClientContext", () => ({
  usePushClient: () => null,
}));

vi.mock("./WidgetGearMenu", () => ({
  GearButton: ({ def }: { def: { name: string } }) => (
    <button type="button" aria-label={`Configure ${def.name}`}>
      gear
    </button>
  ),
  GearWrapper: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function StubWidget(_: ComponentProps) {
  return <div data-testid="stub-widget" />;
}

const STUB_ITEM: DashboardItem = { i: "w1", componentId: "stub" };

describe("GridItemContent — draggableCancel structural guard", () => {
  beforeEach(() => {
    clearRegistry();
    registerComponent({
      id: "stub",
      name: "Stub",
      description: "Test stub",
      tags: [],
      component: StubWidget,
    });
  });

  afterEach(() => {
    clearRegistry();
  });

  it("wraps Remove and Configure buttons in .widget-action-buttons", () => {
    registerComponent({
      id: "configurable-stub",
      name: "Configurable Stub",
      description: "Has config",
      tags: [],
      component: StubWidget,
      configComponent: () => null,
    });

    const item: DashboardItem = { i: "w2", componentId: "configurable-stub" };
    render(
      <GridItemContent
        item={item}
        w={3}
        h={3}
        updateItemConfig={vi.fn()}
        updateItemMappings={vi.fn()}
        removeItem={vi.fn()}
      />,
    );

    const removeBtn = screen.getByRole("button", { name: /Remove widget/i });
    const configureBtn = screen.getByRole("button", { name: /Configure/i });
    const cancelTarget = document.querySelector(".widget-action-buttons");

    expect(cancelTarget).not.toBeNull();
    expect(cancelTarget).toContainElement(removeBtn);
    expect(cancelTarget).toContainElement(configureBtn);
  });

  it("wraps the Remove button in .widget-action-buttons even without a config component", () => {
    render(
      <GridItemContent
        item={STUB_ITEM}
        w={3}
        h={3}
        updateItemConfig={vi.fn()}
        updateItemMappings={vi.fn()}
        removeItem={vi.fn()}
      />,
    );

    const removeBtn = screen.getByRole("button", { name: /Remove widget/i });
    const cancelTarget = document.querySelector(".widget-action-buttons");

    expect(cancelTarget).not.toBeNull();
    expect(cancelTarget).toContainElement(removeBtn);
  });
});
