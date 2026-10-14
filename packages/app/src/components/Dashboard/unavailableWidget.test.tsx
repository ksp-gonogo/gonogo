import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GridItemContent } from "./GridItemContent";
import type { DashboardItem } from "./index";

const ghost: DashboardItem = {
  i: "tile-1",
  componentId: "map-view",
};

function renderGhost(removeItem = vi.fn()) {
  const view = render(
    <GridItemContent
      item={ghost}
      w={6}
      h={6}
      updateItemConfig={vi.fn()}
      updateItemMappings={vi.fn()}
      removeItem={removeItem}
    />,
  );
  return { removeItem, ...view };
}

describe("a saved tile whose widget is not registered", () => {
  it("names the id and says the widget is not available", () => {
    renderGhost();
    expect(screen.getByText("map-view")).toBeInTheDocument();
    expect(screen.getByText(/is not available/)).toBeInTheDocument();
  });

  it("offers a keyboard-operable remove that removes that tile", async () => {
    const user = userEvent.setup();
    const { removeItem } = renderGhost();
    await user.tab();
    const remove = screen.getByRole("button", { name: "Remove" });
    expect(remove).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(removeItem).toHaveBeenCalledWith("tile-1");
  });

  it("has no accessibility violations", async () => {
    const { container } = renderGhost();
    await expectNoA11yViolations(container);
  });
});
