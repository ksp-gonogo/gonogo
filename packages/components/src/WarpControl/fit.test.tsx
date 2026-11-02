import { DashboardItemContext, getComponent } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { AlarmsLauncherProvider } from "../shared/AlarmsLauncher";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { WarpControlComponent } from "./index";

async function mountAt(w: number, h: number) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  render(
    <fixture.Provider>
      <AlarmsLauncherProvider
        launcher={() => {}}
        creator={() => {}}
        pending={[]}
      >
        <DashboardItemContext.Provider value={{ instanceId: "fit" }}>
          <WarpControlComponent id="fit" w={w} h={h} config={{}} />
        </DashboardItemContext.Provider>
      </AlarmsLauncherProvider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("time.warp", {
      warpRate: 1000,
      warpRateIndex: 5,
      warpMode: 0,
      paused: false,
    });
    fixture.emit("spaceCenter.scene", { scene: "Flight" });
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "100k×" })).toBeTruthy(),
  );
  await act(async () => {});
}

describe("WarpControl: the default tile holds the whole ladder", () => {
  it("is tall enough for the two-row rails ladder, with the warp-to row left for taller tiles", async () => {
    const def = getComponent("warp-control");
    const { w, h } = def?.defaultSize ?? { w: 0, h: 0 };
    expect(h).toBeGreaterThanOrEqual(6);

    await mountAt(w, h);

    expect(screen.queryByRole("button", { name: /warp to/i })).toBeNull();
  });

  it("draws the warp-to row once the tile is seven rows tall", async () => {
    await mountAt(6, 7);

    expect(screen.getByRole("button", { name: /warp to/i })).toBeTruthy();
  });

  it("gives a phone tile room for the rate, its label and both ladder rows", () => {
    const def = getComponent("warp-control");

    expect(def?.mobileHeight).toBeGreaterThanOrEqual(200);
  });
});
