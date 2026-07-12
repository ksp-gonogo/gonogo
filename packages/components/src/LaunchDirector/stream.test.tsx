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
 * `crash.hasRecent`/`crash.lastCrash` route to the stream too (whole-topic
 * identity reads off CrashUplink's `ReliableOrdered` channel — a widget
 * mount always picks up whatever crash last landed, same sticky-cache
 * contract as any other topic). The launch-site reads
 * (kc.padOccupied/padVesselTitle/launchSite/launchSites) are mapped onto
 * spaceCenter.launchSites + spaceCenter.scene + the spaceCenter.state derived
 * channel, but their inputs aren't carried in this fixture, so they — along
 * with ksp.* and tar.availableVessels — stay on the legacy fallback, carried
 * by a `setupMockDataSource` AUX.
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
        "crash.hasRecent",
        "crash.lastCrash",
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
    expect(fixture.transport.isSubscribed("crash.hasRecent")).toBe(true);
    expect(fixture.transport.isSubscribed("crash.lastCrash")).toBe(true);

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

  it("surfaces a crash chip and disables recover when the streamed crash is for the active vessel", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["crash.hasRecent", "crash.lastCrash"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [
        { key: "kc.savedShips" },
        { key: "kc.padOccupied" },
        { key: "kc.scene" },
        { key: "v.name" },
        { key: "v.missionTime" },
        { key: "v.altitude" },
        { key: "ksp.canRevertToLaunch" },
        { key: "ksp.canRevertToEditor" },
      ],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "ld-stream-crash" }}
        >
          <LaunchDirectorComponent id="ld-stream-crash" w={7} h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("crash.hasRecent")).toBe(true);
    expect(fixture.transport.isSubscribed("crash.lastCrash")).toBe(true);

    act(() => {
      legacyAux.source.emit("kc.savedShips", []);
      legacyAux.source.emit("kc.padOccupied", true);
      legacyAux.source.emit("kc.scene", "Flight");
      legacyAux.source.emit("v.name", "Doomed Probe");
      legacyAux.source.emit("v.missionTime", 12);
      legacyAux.source.emit("v.altitude", 50);
      legacyAux.source.emit("ksp.canRevertToLaunch", false);
      legacyAux.source.emit("ksp.canRevertToEditor", false);
      fixture.emit("crash.hasRecent", true);
      fixture.emit("crash.lastCrash", { vesselName: "Doomed Probe" });
    });

    await waitFor(() =>
      expect(
        screen.getByText(/Crash in progress — return to Space Center/i),
      ).toBeInTheDocument(),
    );
    const recoverBtn = screen.getByRole("button", { name: /^Recover$/i });
    expect(recoverBtn).toBeDisabled();

    teardownMockDataSource(legacyAux);
  });
});
