import {
  clearActionHandlers,
  clearAugments,
  DashboardItemContext,
  getAugmentsForSlot,
  registerAugment,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { WarpControlComponent } from "./index";

/**
 * WarpControl exposes one augment slot, `warp-control.stepper`, which no
 * built-in augment fills, so an unaugmented widget composes nothing there.
 */
// Reset at the start of each test, once the prior test's tree is already unmounted.
beforeEach(() => {
  clearActionHandlers();
  clearAugments();
});

function renderWarp() {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
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

describe("WarpControl: augment slots", () => {
  it("renders with the slots empty when no augment is registered", async () => {
    renderWarp();
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: "Time warp rate 10×" }),
      ).toBeTruthy(),
    );
    expect(screen.queryByTestId("warp-actions-augment")).toBeNull();
  });

  it("composes an augment registered into warp-control.stepper", async () => {
    registerAugment({
      id: "test-warp-action",
      augments: "warp-control.stepper",
      component: () => (
        <button type="button" data-testid="warp-actions-augment">
          Warp to periapsis
        </button>
      ),
    });
    expect(getAugmentsForSlot("warp-control.stepper").map((a) => a.id)).toEqual(
      ["test-warp-action"],
    );

    renderWarp();
    await waitFor(() =>
      expect(screen.getByTestId("warp-actions-augment")).toBeTruthy(),
    );
    expect(screen.getByText("Warp to periapsis")).toBeTruthy();
  });
});
