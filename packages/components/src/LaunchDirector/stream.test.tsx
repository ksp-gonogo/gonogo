import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LaunchDirectorComponent } from "./index";

/**
 * LaunchDirector running off the real stream pipeline via `StubTransport`,
 * with no legacy `DataSource` registered. The in-flight scene reports
 * `launchUt: null`, so `missionTime` renders the null-display placeholder.
 */
afterEach(() => {
  clearActionHandlers();
});

describe("LaunchDirector: genuinely runs off the stream", () => {
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
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ld-stream" }}>
          {/* 18 rows, so the crew grid stands open. */}
          <LaunchDirectorComponent id="ld-stream" w={7} h={18} />
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
      fixture.emit("spaceCenter.launchSites", [
        {
          name: "LaunchPad",
          displayName: "KSC Launch Pad",
          editorFacility: "VAB",
          body: "Kerbin",
          isStock: true,
          padOccupied: false,
          padVesselTitle: null,
        },
      ]);
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

    // Number, glyph and spoken word are three elements, so no single node holds "· 42,500".
    await waitFor(() => expect(visibleText()).toContain("· 42,500f"));
    expect(screen.getByText("Kerbal X")).toBeTruthy();

    // The crew picker only renders once a ship is selected.
    await act(async () => {
      screen.getByText("Kerbal X").click();
    });
    await waitFor(() =>
      expect(screen.getByText("Jebediah Kerman")).toBeTruthy(),
    );
  });

  it("surfaces a crash chip when the streamed crash is for the active vessel, and leaves Recover to the command", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [
        "spaceCenter.savedShips",
        "spaceCenter.scene",
        "vessel.flight",
        "vessel.identity",
        "crash.hasRecent",
        "crash.lastCrash",
      ],
      pinnedUt: 10,
      suspendFrames: true,
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
      expect(screen.getByText(/Crash in progress/i)).toBeInTheDocument(),
    );
    const recoverBtn = screen.getByRole("button", { name: /^Recover$/i });
    expect(recoverBtn).not.toHaveAttribute("aria-disabled");
  });
});
