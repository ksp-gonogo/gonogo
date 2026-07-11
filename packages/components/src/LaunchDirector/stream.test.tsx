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
 * LaunchDirector's stream test-adapter proof: genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport`. `career.funds` (-> `career.status.economy.funds`) is a
 * funds spender per CLAUDE.md's "always show the balance" rule.
 * `kc.savedShips`/`kc.crewRoster` are mapped onto SpaceCenterUplink's own
 * `spaceCenter.savedShips`/`spaceCenter.crewRoster` bare-array topics.
 * Every other read (kc.padOccupied/padVesselTitle/launchSite/launchSites,
 * ksp.*, crash.*, tar.availableVessels) stays legacy — carried by a
 * `setupMockDataSource` AUX.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("LaunchDirector — genuinely runs off the stream", () => {
  it("renders the funds readout, saved ships and crew roster all off the stream", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [
        "career.status",
        "spaceCenter.savedShips",
        "spaceCenter.crewRoster",
      ],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [
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
    expect(fixture.transport.isSubscribed("spaceCenter.savedShips")).toBe(true);
    expect(fixture.transport.isSubscribed("spaceCenter.crewRoster")).toBe(true);

    act(() => {
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
      fixture.emit("spaceCenter.savedShips", [
        {
          name: "Kerbal X",
          partCount: 24,
          totalMass: 18.4,
          facility: "VAB",
          requiresFunds: 0,
          missingParts: [],
        },
      ]);
      fixture.emit("spaceCenter.crewRoster", [
        {
          name: "Jebediah Kerman",
          trait: "Pilot",
          experienceLevel: 3,
          available: true,
          unavailableReason: "",
        },
      ]);
    });

    await waitFor(() => expect(screen.getByText("· 42,500f")).toBeTruthy());
    expect(screen.getByText("Kerbal X")).toBeTruthy();

    // The crew picker only renders once a ship is selected.
    await act(async () => {
      screen.getByText("Kerbal X").click();
    });
    await waitFor(() =>
      expect(screen.getByText("Jebediah Kerman")).toBeTruthy(),
    );

    teardownMockDataSource(legacyAux);
  });
});
