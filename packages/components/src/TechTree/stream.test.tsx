import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TechTreeComponent } from "./index";

/**
 * Stream test-adapter proof for TechTree: genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport`. `career.science` (-> `career.status.economy.science`),
 * `tech.nodes` (-> `career.status.tech.nodes`), AND `kc.scene` (->
 * `spaceCenter.scene.scene`) all stream now — no legacy `DataSource` aux
 * needed for this widget any more.
 */
// Reset the action-handler registry at the START of each test — the prior
// test's tree is already unmounted (RTL auto-cleanup) by then, so this never
// fires against a live component.
beforeEach(() => {
  clearActionHandlers();
});

describe("TechTree — genuinely runs off the stream (M3/M3b career batch)", () => {
  it("renders the science readout derived from career.status.economy.science", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["career.status", "spaceCenter.scene"],
      pinnedUt: 10,
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
      // tech.nodes now streams via career.status.tech.nodes — the wire
      // shape carries `unlocked: boolean`, not the legacy `state` string
      // (CareerViewProvider.BuildTechNodes; parseTechNodes derives
      // Available/Unavailable from it client-side).
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

    await waitFor(() => expect(screen.getByText("· 4854 sci")).toBeTruthy());
    expect(screen.getByText("General Rocketry")).toBeTruthy();
  });
});
