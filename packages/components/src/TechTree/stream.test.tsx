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
 * The M3 career batch's stream test-adapter proof for TechTree: genuinely
 * running off the real `TelemetryProvider`/`TelemetryClient`/`TimelineStore`
 * pipeline via `StubTransport`. `career.science` is the ONE mapped read
 * (-> `career.status.economy.science`, map-topic.ts). `tech.nodes` stays
 * gapped (no titles/costs/parent edges on the wire yet — see map-topic.ts's
 * doc comment) — carried by a `setupMockDataSource` AUX, same mixed-source
 * pattern the vessel-gap batch established.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("TechTree — genuinely runs off the stream (M3 career batch)", () => {
  it("renders the science readout derived from career.status.economy.science", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "tech.nodes" }, { key: "kc.scene" }],
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
      legacyAux.source.emit("tech.nodes", [
        {
          id: "basicRocketry",
          title: "Basic Rocketry",
          description: "",
          scienceCost: 0,
          state: "Available",
          parents: [],
          parts: [],
        },
        {
          id: "engineering101",
          title: "General Rocketry",
          description: "",
          scienceCost: 15,
          state: "Unavailable",
          parents: ["basicRocketry"],
          parts: [],
        },
      ]);
      fixture.emit("career.status", {
        economy: { funds: 100, reputation: 0, science: 4854 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() => expect(screen.getByText("· 4854 sci")).toBeTruthy());

    teardownMockDataSource(legacyAux);
  });
});
