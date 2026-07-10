import {
  clearActionHandlers,
  clearAugments,
  DashboardItemContext,
  getAugmentsForSlot,
  registerAugment,
} from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { WarpControlComponent } from "./index";

/**
 * WarpControl exposes two augment slots (Uplink architecture §4, locked in
 * `augment-slot-map.md` Feedback round 1): `warp-control.actions` (footer
 * action row — an Uplink contributes a "Warp to <mod-event>" action alongside
 * the widget's own warp buttons) and `warp-control.badges` (header escape
 * hatch). P2 only EXPOSES the slots; no built-in augment fills them, so an
 * unaugmented widget renders exactly as before — the slots compose nothing.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
  clearAugments();
});

function renderWarp() {
  const fixture = setupStreamFixture({
    carriedChannels: ["time.warp"],
    pinnedUt: 10,
  });
  const utils = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "warp-aug" }}>
        <WarpControlComponent id="warp-aug" w={6} h={5} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("time.warp", {
      warpRate: 10,
      warpRateIndex: 2,
      warpMode: 0,
      paused: false,
    });
  });
  return { fixture, ...utils };
}

describe("WarpControl — augment slots", () => {
  it("renders with the slots empty when no augment is registered", async () => {
    renderWarp();
    // The widget still renders its own output; the empty slots add nothing.
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: "Time warp rate 10×" }),
      ).toBeTruthy(),
    );
    expect(screen.queryByTestId("warp-actions-augment")).toBeNull();
    expect(screen.queryByTestId("warp-badges-augment")).toBeNull();
  });

  it("composes an augment registered into warp-control.actions", async () => {
    registerAugment({
      id: "test-warp-action",
      augments: "warp-control.actions",
      component: () => (
        <button type="button" data-testid="warp-actions-augment">
          Warp to periapsis
        </button>
      ),
    });
    expect(getAugmentsForSlot("warp-control.actions").map((a) => a.id)).toEqual(
      ["test-warp-action"],
    );

    renderWarp();
    await waitFor(() =>
      expect(screen.getByTestId("warp-actions-augment")).toBeTruthy(),
    );
    expect(screen.getByText("Warp to periapsis")).toBeTruthy();
  });

  it("composes an augment registered into warp-control.badges", async () => {
    registerAugment({
      id: "test-warp-badge",
      augments: "warp-control.badges",
      component: () => <span data-testid="warp-badges-augment">SOI</span>,
    });

    renderWarp();
    await waitFor(() =>
      expect(screen.getByTestId("warp-badges-augment")).toBeTruthy(),
    );
  });
});
