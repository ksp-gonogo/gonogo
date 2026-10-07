import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it, vi } from "vitest";
import { Dashboard } from "./index";

const NOOP = vi.fn();

function renderDashboard(items: Parameters<typeof Dashboard>[0]["items"]) {
  return render(
    <Dashboard
      items={items}
      layouts={{}}
      currentLayouts={{}}
      breakpoint="lg"
      onLayoutChange={NOOP}
      onBreakpointChange={NOOP}
      updateItemConfig={NOOP}
      updateItemMappings={NOOP}
      updateItemMobileWidth={NOOP}
      updateItemMobileHeight={NOOP}
      removeItem={NOOP}
      moveItemUp={NOOP}
      moveItemDown={NOOP}
    />,
  );
}

describe("Dashboard with no widgets", () => {
  it("says so and names the control that adds one", async () => {
    const { container } = renderDashboard([]);

    expect(screen.getByText("No widgets on this dashboard")).toBeVisible();
    expect(screen.getByText(/Add component/)).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it("shows no notice once a widget is placed", () => {
    renderDashboard([{ i: "a", componentId: "not-registered" }]);

    expect(screen.queryByText("No widgets on this dashboard")).toBeNull();
  });
});
