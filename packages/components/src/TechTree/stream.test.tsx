import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TechTreeComponent } from "./index";

/** TechTree off the real stream pipeline: science, tech nodes and scene all stream, with no legacy `DataSource`. */
// Reset at the start of each test, when the prior tree is already unmounted.
beforeEach(() => {
  clearActionHandlers();
});

describe("TechTree: genuinely runs off the stream (M3/M3b career batch)", () => {
  it("renders the science readout derived from career.status.economy.science", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["career.status", "spaceCenter.scene"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "tt-stream" }}>
          <TechTreeComponent id="tt-stream" w={6} h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("career.status")).toBe(true);

    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      // The wire shape carries `unlocked: boolean`, not a `state` string.
      fixture.emit("career.status", {
        economy: { funds: 100, reputation: 0, science: 4854 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: {
          unlockedCount: 1,
          unlockedIds: ["basicRocketry"],
          nodes: [
            {
              id: "basicRocketry",
              title: "Basic Rocketry",
              scienceCost: 0,
              unlocked: true,
              parents: [],
            },
            {
              id: "engineering101",
              title: "General Rocketry",
              scienceCost: 15,
              unlocked: false,
              parents: ["basicRocketry"],
            },
          ],
        },
      });
    });

    // `getByText` sees only direct text nodes; the full `textContent` is what a screen reader hears, and the glyph is aria-hidden, so the hidden word must be there.
    const sci = await screen.findByText("· 4854");
    expect(sci.textContent).toBe("· 4854 science");
    expect(screen.getByText("General Rocketry")).toBeTruthy();
  });
});
