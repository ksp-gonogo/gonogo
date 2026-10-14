import { render, screen } from "@ksp-gonogo/test-utils";
import {
  expectLiveRegionPrimed,
  expectNoA11yViolations,
} from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetUplinkOutcomes,
  setUplinkOutcome,
  setUplinksSettled,
} from "../../uplinks/loaderState";
import { GridItemContent } from "./GridItemContent";
import type { DashboardItem } from "./index";

const ghost: DashboardItem = {
  i: "tile-1",
  componentId: "map-view",
};

function renderGhost(removeItem = vi.fn(), componentId = ghost.componentId) {
  const view = render(
    <GridItemContent
      item={{ ...ghost, componentId }}
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
  beforeEach(() => {
    __resetUplinkOutcomes();
    setUplinksSettled();
  });

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

  it("cannot be removed before the Uplinks have been attempted, since its widget may still arrive", async () => {
    __resetUplinkOutcomes();
    const user = userEvent.setup();
    const { removeItem } = renderGhost();
    expect(screen.getByText(/is not available/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(removeItem).not.toHaveBeenCalled();
  });

  const broken = {
    id: "broken",
    name: "Broken Add-on",
    status: "quarantined",
    reason: "hash mismatch",
  } as const;

  it("says the owning add-on failed to load and asks for a second press before removing the tile", async () => {
    setUplinkOutcome(broken);
    const user = userEvent.setup();
    const { removeItem } = renderGhost(vi.fn(), "broken-gauge");
    expect(screen.getByText(/Broken Add-on failed to load/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(removeItem).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Press again to remove" }),
    );
    expect(removeItem).toHaveBeenCalledWith("tile-1");
  });

  it("names no add-on and removes in one press when a different add-on is the one that failed", async () => {
    setUplinkOutcome(broken);
    const user = userEvent.setup();
    const { removeItem } = renderGhost(vi.fn(), "map-view");
    expect(screen.queryByText(/failed to load/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(removeItem).toHaveBeenCalledWith("tile-1");
  });

  it("does not take an id that merely starts with the add-on's id for one of its widgets", () => {
    setUplinkOutcome(broken);
    renderGhost(vi.fn(), "brokenish-gauge");
    expect(screen.queryByText(/failed to load/)).toBeNull();
  });

  it("drops the second press when focus leaves the button", async () => {
    setUplinkOutcome(broken);
    const user = userEvent.setup();
    const { removeItem } = renderGhost(vi.fn(), "broken-gauge");
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(removeItem).not.toHaveBeenCalled();
  });

  describe("with the clock held", () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it("drops the second press after a few seconds", async () => {
      setUplinkOutcome(broken);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { removeItem } = renderGhost(vi.fn(), "broken-gauge");
      await user.click(screen.getByRole("button", { name: "Remove" }));
      expect(
        screen.getByRole("button", { name: "Press again to remove" }),
      ).toBeVisible();
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByRole("button", { name: "Remove" })).toBeVisible();
      expect(removeItem).not.toHaveBeenCalled();
    });
  });

  it("keeps the failed-add-on message in a live region that was mounted before it had anything to say", async () => {
    const { container } = renderGhost(vi.fn(), "broken-gauge");
    await expectLiveRegionPrimed(container, () => setUplinkOutcome(broken));
  });
});
