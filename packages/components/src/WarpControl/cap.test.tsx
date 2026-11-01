import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { WarpControlComponent } from "./index";

async function mountWith(
  warp: Record<string, unknown>,
  size: { w: number; h: number } = { w: 6, h: 5 },
) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "warp-cap" }}>
        <WarpControlComponent id="warp-cap" {...size} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("time.warp", { warpMode: 0, paused: false, ...warp });
    fixture.emit("spaceCenter.scene", { scene: "Flight" });
  });
  await waitFor(() => expect(screen.getByRole("img")).toBeTruthy());
}

describe("WarpControl names the warp ceiling the game is holding it to", () => {
  it("shows the highest rung the game allows beside the rate while the rung sits at it", async () => {
    await mountWith({ warpRate: 40, warpRateIndex: 4, maxWarpRateIndex: 4 });
    expect(screen.getByText("CAP 100×")).toBeTruthy();
  });

  it("shows nothing of a cap while the game allows the top rung", async () => {
    await mountWith({ warpRate: 1000, warpRateIndex: 5, maxWarpRateIndex: 7 });
    expect(screen.queryByText(/^CAP /)).toBeNull();
  });

  it("shows nothing of a cap when the game does not report one", async () => {
    await mountWith({ warpRate: 1000, warpRateIndex: 5 });
    expect(screen.queryByText(/^CAP /)).toBeNull();
  });

  it("shows nothing of a cap at real time", async () => {
    await mountWith({ warpRate: 1, warpRateIndex: 0, maxWarpRateIndex: 0 });
    expect(screen.queryByText(/^CAP /)).toBeNull();
  });

  it("keeps the rate readout's label naming the rate alone", async () => {
    await mountWith({ warpRate: 40, warpRateIndex: 4, maxWarpRateIndex: 4 });
    expect(
      screen.getByRole("img", { name: "Time warp rate 40×" }),
    ).toBeTruthy();
  });
});
