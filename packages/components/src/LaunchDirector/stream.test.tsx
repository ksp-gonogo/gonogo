import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LaunchDirectorComponent } from "./index";

/**
 * LaunchDirector's stream test-adapter proof: genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport` — no legacy `DataSource` is registered anywhere in this
 * file. Every read this widget makes has a real wire home now:
 * `career.funds` (-> `career.status.economy.funds`, a funds spender per
 * CLAUDE.md's "always show the balance" rule), `kc.savedShips`/
 * `kc.crewRoster` (-> `spaceCenter.savedShips`/`spaceCenter.crewRoster`),
 * `kc.padOccupied`/`kc.padVesselTitle` (-> the `spaceCenter.state` derived
 * channel, itself derived off `spaceCenter.launchSites`),
 * `kc.launchSite`/`kc.scene` (-> `spaceCenter.scene`'s raw fields),
 * `kc.launchSites` (-> `spaceCenter.launchSites` directly),
 * `v.name` (-> `vessel.identity.name`), `v.missionTime`/`v.altitude` (->
 * the `vessel.state` derived channel's `met`/`altitudeAsl`),
 * `ksp.canRevertToLaunch`/`ksp.canRevertToEditor` (->
 * `ksp.revertAvailability`), and `crash.hasRecent`/`crash.lastCrash` (->
 * themselves, whole-topic identity reads). `tar.availableVessels` (->
 * `system.vessels`) is carried too, though the switcher hasn't been
 * migrated to normalise the new roster shape yet (see `index.tsx`'s own
 * comment) — its list stays empty regardless of what's emitted.
 *
 * `vessel.state.met`/`altitudeAsl` are mutually exclusive by design
 * (`vessel-state.ts`'s own doc): `met` only derives in the OnRails/
 * "propagated" basis, `altitudeAsl` only in the Loaded/"measured" basis. The
 * ACTIVE (flying) vessel this widget's in-flight panel describes is always
 * Loaded, so `missionTime` genuinely renders "—" here — a real, documented
 * gap in the migrated data (not a test omission).
 */
afterEach(() => {
  clearActionHandlers();
});

describe("LaunchDirector — genuinely runs off the stream", () => {
  it("renders the funds readout, saved ships and crew roster all off the stream", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [
        "career.status",
        "spaceCenter.savedShips",
        "spaceCenter.crewRoster",
        "spaceCenter.scene",
        "spaceCenter.launchSites",
      ],
      pinnedUt: 10,
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
      fixture.emit("spaceCenter.scene", {
        scene: "SpaceCenter",
        launchSite: "LaunchPad",
      });
      fixture.emit("spaceCenter.launchSites", []);
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
  });

  it("surfaces a crash chip and disables recover when the streamed crash is for the active vessel", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [
        "spaceCenter.savedShips",
        "spaceCenter.scene",
        "vessel.orbit",
        "vessel.flight",
        "vessel.identity",
        "system.bodies",
        "vessel.control",
        "vessel.target",
        "vessel.comms",
        "vessel.propulsion",
        "crash.hasRecent",
        "crash.lastCrash",
      ],
      pinnedUt: 10,
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
      fixture.emit("spaceCenter.savedShips", []);
      fixture.emit("spaceCenter.scene", { scene: "Flight" });
      fixture.emit("vessel.identity", {
        vesselId: "doomed-probe",
        name: "Doomed Probe",
        vesselType: 0,
        situation: 0,
        parentBodyIndex: 1,
        launchUt: null,
      });
      // Loaded quality -> the "measured" basis, so altitudeAsl resolves off
      // vessel.flight (met stays null — see this file's doc comment).
      fixture.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 1,
          sma: 700000,
          ecc: 0.01,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 10,
          mu: 3.5316e12,
        },
        { quality: 1 },
      );
      fixture.emit("vessel.flight", {
        latitude: -0.1,
        longitude: -74.6,
        altitudeAsl: 50,
        altitudeTerrain: 50,
        verticalSpeed: -2,
        surfaceSpeed: 3,
        orbitalSpeed: 3,
        gForce: 1,
        dynamicPressureKPa: 0,
        mach: 0,
        atmDensity: 1.2,
      });
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
  });
});
