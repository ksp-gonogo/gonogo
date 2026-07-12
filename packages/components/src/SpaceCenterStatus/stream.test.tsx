import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SpaceCenterStatusComponent } from "./index";

/**
 * SpaceCenterStatus's stream test-adapter proof: genuinely running off the
 * real `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport`. `career.funds` (-> `career.status.economy.funds`) is a
 * funds spender per CLAUDE.md's "always show the balance" rule, so it must
 * stream. `kc.facilityLevels` (-> `career.status.facilities`) and `kc.scene`
 * (-> `spaceCenter.scene.scene`) stream too, and now `kc.partsAvailable`
 * (-> `spaceCenter.partsAvailable.count`) as well. `kc.launchSite`
 * (-> `spaceCenter.scene.launchSite`), `kc.padOccupied`/`kc.padVesselTitle`
 * (-> the `spaceCenter.state` derived channel) are mapped too but their input
 * channel (`spaceCenter.launchSites`) isn't carried in most of these
 * fixtures, so those reads stay on the legacy fallback — carried by a small
 * `setupMockDataSource` AUX. The last test below is the exception: it carries
 * `spaceCenter.launchSites` and proves `kc.padVesselTitle` reads the streamed
 * pad-occupancy entry rather than the legacy AUX.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("SpaceCenterStatus — genuinely runs off the stream", () => {
  it("renders the funds readout and parts-available count both off the stream", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [
        "career.status",
        "spaceCenter.scene",
        "spaceCenter.partsAvailable",
      ],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [
        { key: "kc.launchSite" },
        { key: "kc.padOccupied" },
        { key: "kc.padVesselTitle" },
      ],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "scs-stream" }}>
          <SpaceCenterStatusComponent id="scs-stream" w={6} h={7} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("career.status")).toBe(true);
    expect(fixture.transport.isSubscribed("spaceCenter.partsAvailable")).toBe(
      true,
    );

    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit("spaceCenter.partsAvailable", { count: 214 });
      legacyAux.source.emit("kc.padOccupied", false);
      legacyAux.source.emit("kc.launchSite", "KSC");
      fixture.emit("career.status", {
        economy: { funds: 78400.5, reputation: 200, science: 100 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() => expect(screen.getByText("· 78,401f")).toBeTruthy());
    expect(screen.getByText("214")).toBeTruthy();

    teardownMockDataSource(legacyAux);
  });

  it("renders the tiny-bucket funds readout from the same stream key", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [
        { key: "kc.launchSite" },
        { key: "kc.padOccupied" },
        { key: "kc.padVesselTitle" },
      ],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "scs-tiny" }}>
          <SpaceCenterStatusComponent id="scs-tiny" w={2} h={3} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("kc.padOccupied", false);
      fixture.emit("career.status", {
        economy: { funds: 78400.5, reputation: 200, science: 100 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() => expect(screen.getByTitle("78,401f")).toBeTruthy());

    teardownMockDataSource(legacyAux);
  });

  it("renders facility tiers/upgrade costs derived from career.status.facilities", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["career.status", "spaceCenter.scene"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [
        { key: "kc.launchSite" },
        { key: "kc.padOccupied" },
        { key: "kc.padVesselTitle" },
      ],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "scs-facilities" }}>
          <SpaceCenterStatusComponent id="scs-facilities" w={6} h={7} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit("career.status", {
        economy: { funds: 500000, reputation: 0, science: 0 },
        facilities: {
          LaunchPad: { currentTier: 1, maxTier: 2, upgradeCost: 150000 },
          VehicleAssemblyBuilding: {
            currentTier: 2,
            maxTier: 2,
            upgradeCost: null,
          },
        },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    // "tier 2 of 3" — displayLevel/displayMax are currentTier/maxTier + 1
    // (0-based tiers on the wire, 1-based "Lvl N of M" display).
    await waitFor(() =>
      expect(screen.getByLabelText("Launch Pad tier 2 of 3")).toBeTruthy(),
    );
    expect(screen.getByText("150.0k")).toBeTruthy();
    expect(screen.getByLabelText("VAB tier 3 of 3")).toBeTruthy();
    expect(screen.getByText("MAX")).toBeTruthy();

    teardownMockDataSource(legacyAux);
  });

  it("renders the pad-vessel title from the streamed spaceCenter.launchSites array, not the legacy fallback", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [
        "career.status",
        "spaceCenter.scene",
        "spaceCenter.launchSites",
      ],
      pinnedUt: 10,
    });
    // The legacy AUX carries a DIFFERENT vessel name than the streamed
    // fixture — if the widget were still reading the legacy fallback instead
    // of `spaceCenter.state.padVesselTitle`, this is what would render.
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [
        { key: "kc.launchSite" },
        { key: "kc.padOccupied" },
        { key: "kc.padVesselTitle" },
      ],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "scs-pad-vessel" }}>
          <SpaceCenterStatusComponent id="scs-pad-vessel" w={6} h={7} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("spaceCenter.launchSites")).toBe(
      true,
    );

    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit("spaceCenter.launchSites", [
        { padOccupied: true, padVesselTitle: "Kerbal X" },
      ]);
      legacyAux.source.emit("kc.padOccupied", true);
      legacyAux.source.emit("kc.padVesselTitle", "Legacy Ghost Ship");
      fixture.emit("career.status", {
        economy: { funds: 100000, reputation: 200, science: 100 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() =>
      expect(screen.getByText("On pad: Kerbal X")).toBeTruthy(),
    );
    expect(screen.queryByText(/Legacy Ghost Ship/)).toBeNull();

    teardownMockDataSource(legacyAux);
  });
});
