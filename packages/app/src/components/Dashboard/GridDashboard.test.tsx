/*
 * The tile chrome is drawn only while a tile is hovered or has focus inside
 * it. jsdom has neither pointer hover nor a computed style for a rule that
 * names a pseudo-element, so each state is checked on the stylesheet's rules.
 */
import {
  type ComponentProps,
  clearContributions,
  clearRegistry,
  registerComponent,
} from "@ksp-gonogo/core";
import { render, screen } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GridDashboard } from "./GridDashboard";

vi.mock("@ksp-gonogo/components", () => ({
  SeatGuard: (props: { children: React.ReactNode }) => <>{props.children}</>,
  RequiresGuard: (props: { children: React.ReactNode }) => (
    <>{props.children}</>
  ),
}));

vi.mock("../../pushToMain/PushClientContext", () => ({
  usePushClient: () => null,
}));

function StubWidget(_: ComponentProps) {
  return <div data-testid="stub-widget" />;
}

const LAYOUT = [{ i: "w1", x: 0, y: 0, w: 6, h: 6 }];

function mount() {
  const layouts = {
    lg: LAYOUT,
    md: LAYOUT,
    sm: LAYOUT,
    xs: LAYOUT,
    xxs: LAYOUT,
  };
  return render(
    <GridDashboard
      items={[{ i: "w1", componentId: "stub" }]}
      layouts={layouts}
      currentLayouts={layouts}
      breakpoint="lg"
      onLayoutChange={vi.fn()}
      onBreakpointChange={vi.fn()}
      updateItemConfig={vi.fn()}
      updateItemMappings={vi.fn()}
      updateItemMobileWidth={vi.fn()}
      updateItemMobileHeight={vi.fn()}
      removeItem={vi.fn()}
      moveItemUp={vi.fn()}
      moveItemDown={vi.fn()}
    />,
  );
}

function styleRules(): CSSStyleRule[] {
  const rules: CSSStyleRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule instanceof CSSStyleRule) rules.push(rule);
    }
  }
  return rules;
}

describe("GridDashboard tile chrome", () => {
  beforeEach(() => {
    clearRegistry();
    clearContributions();
    registerComponent({
      id: "stub",
      name: "Stub",
      description: "Test stub",
      tags: [],
      component: StubWidget,
    });
  });

  it("hides the grab bar and the resize marks at rest without unmounting them", () => {
    mount();
    expect(document.querySelector(".drag-handle")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Remove widget/i })).toBeTruthy();
    const hidden = styleRules().filter(
      (r) =>
        r.selectorText.includes(".drag-handle") &&
        !r.selectorText.includes(":hover") &&
        !r.selectorText.includes(":focus-within") &&
        r.style.opacity === "0",
    );
    expect(hidden.length).toBeGreaterThan(0);
    expect(
      hidden.some((r) => r.selectorText.includes(".react-resizable-handle")),
    ).toBe(true);
  });

  it.each([
    ":hover",
    ":focus-within",
  ])("shows the grab bar and the resize marks on %s", (state) => {
    mount();
    const shown = styleRules().filter(
      (r) =>
        r.selectorText.includes(state) &&
        r.selectorText.includes(".drag-handle") &&
        r.style.opacity === "1",
    );
    expect(shown.length).toBeGreaterThan(0);
    expect(
      shown.some((r) => r.selectorText.includes(".react-resizable-handle")),
    ).toBe(true);
  });

  it("marks the grab bar with the grid icon", () => {
    mount();
    const bar = document.querySelector(".drag-handle");
    expect(bar?.querySelector("svg")).not.toBeNull();
  });
});
