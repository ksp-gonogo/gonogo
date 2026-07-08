import { clearActionHandlers, DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SpaceCenterStatusComponent } from "./index";

/**
 * The M3 career batch's stream test-adapter proof for SpaceCenterStatus:
 * genuinely running off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport`. `career.funds` is the ONE
 * mapped read (-> `career.status.economy.funds`, map-topic.ts) — a funds
 * spender per CLAUDE.md's "always show the balance" rule, so it must stream.
 * `kc.facilityLevels`/`kc.partsAvailable`/`kc.launchSite`/`kc.padOccupied`/
 * `kc.padVesselTitle`/`kc.scene` are all still-gapped kc.* GonogoTelemetry
 * keys with no career.status equivalent shape — carried by a small
 * `setupMockDataSource` AUX, same mixed-source pattern the vessel-gap batch
 * established.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("SpaceCenterStatus — genuinely runs off the stream (M3 career batch)", () => {
  it("renders the funds readout derived from career.status.economy.funds", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [
        { key: "kc.facilityLevels" },
        { key: "kc.partsAvailable" },
        { key: "kc.launchSite" },
        { key: "kc.padOccupied" },
        { key: "kc.padVesselTitle" },
        { key: "kc.scene" },
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

    act(() => {
      legacyAux.source.emit("kc.scene", "SpaceCenter");
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
        { key: "kc.facilityLevels" },
        { key: "kc.partsAvailable" },
        { key: "kc.launchSite" },
        { key: "kc.padOccupied" },
        { key: "kc.padVesselTitle" },
        { key: "kc.scene" },
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
});
