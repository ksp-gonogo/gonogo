import { clearActionHandlers, DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TechTreeComponent } from "./index";

/**
 * The M3/M3b career batch's stream test-adapter proof for TechTree:
 * genuinely running off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport`. `career.science`
 * (-> `career.status.economy.science`) AND `tech.nodes` (->
 * `career.status.tech.nodes`, M3b career-detail batch) both stream now.
 * `kc.scene` stays gapped (no career.status equivalent) — carried by a
 * `setupMockDataSource` AUX, same mixed-source pattern the vessel-gap batch
 * established.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("TechTree — genuinely runs off the stream (M3/M3b career batch)", () => {
  it("renders the science readout derived from career.status.economy.science", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "kc.scene" }],
      connectSource: true,
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
      legacyAux.source.emit("kc.scene", "SpaceCenter");
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

    teardownMockDataSource(legacyAux);
  });
});
