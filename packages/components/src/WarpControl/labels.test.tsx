import { DashboardItemContext, getComponent } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { WarpControlComponent } from "./index";

const FLAT_TIME_KEY = /\bt\.[a-zA-Z]/;

// Captured at import, before a per-test registry reset wipes the module-load registration.
const warpControlDef = getComponent("warp-control");

async function mountInFlight(paused: boolean) {
  const fixture = setupStreamFixture({
    carriedChannels: ["time.warp", "spaceCenter.scene"],
    pinnedUt: 10,
    suspendFrames: true,
  });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "warp-labels" }}>
        <WarpControlComponent id="warp-labels" w={6} h={5} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("time.warp", {
      warpRate: 1,
      warpRateIndex: 0,
      warpMode: 0,
      paused,
    });
    fixture.emit("spaceCenter.scene", { scene: "Flight" });
  });
  const name = paused ? "Resume game" : "Pause game";
  await waitFor(() =>
    expect(screen.getByRole("button", { name })).toBeTruthy(),
  );
  return screen.getByRole("button", { name });
}

describe("WarpControl labels name the widget's own actions", () => {
  it("titles the pause button by its action", async () => {
    const button = await mountInFlight(false);
    expect(button.getAttribute("title")).toBe("Pause");
  });

  it("titles the resume button by its action", async () => {
    const button = await mountInFlight(true);
    expect(button.getAttribute("title")).toBe("Resume");
  });

  it("describes the widget without a flat t. key", () => {
    const description = warpControlDef?.description ?? "";
    expect(description).not.toBe("");
    expect(description).not.toMatch(FLAT_TIME_KEY);
  });
});
