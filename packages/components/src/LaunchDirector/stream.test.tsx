import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LaunchDirectorComponent } from "./index";

/**
 * The M3 career batch's stream test-adapter proof for LaunchDirector:
 * genuinely running off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport`. `career.funds` is the ONE
 * mapped read (-> `career.status.economy.funds`, map-topic.ts) — a funds
 * spender per CLAUDE.md's "always show the balance" rule, so it must stream.
 * Every other read (kc.*, ksp.*, crash.*, tar.availableVessels) stays legacy
 * — carried by a `setupMockDataSource` AUX, same mixed-source pattern the
 * vessel-gap batch established.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("LaunchDirector — genuinely runs off the stream (M3 career batch)", () => {
  it("renders the funds readout derived from career.status.economy.funds", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [
        { key: "kc.savedShips" },
        { key: "kc.crewRoster" },
        { key: "kc.padOccupied" },
        { key: "kc.padVesselTitle" },
        { key: "kc.launchSite" },
        { key: "kc.launchSites" },
        { key: "kc.scene" },
      ],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ld-stream" }}>
          <LaunchDirectorComponent id="ld-stream" w={7} h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("career.status")).toBe(true);

    act(() => {
      legacyAux.source.emit("kc.savedShips", []);
      legacyAux.source.emit("kc.crewRoster", []);
      legacyAux.source.emit("kc.padOccupied", false);
      legacyAux.source.emit("kc.launchSites", []);
      legacyAux.source.emit("kc.scene", "SpaceCenter");
      fixture.emit("career.status", {
        economy: { funds: 42500, reputation: 200, science: 100 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() => expect(screen.getByText("· 42,500f")).toBeTruthy());

    teardownMockDataSource(legacyAux);
  });
});
