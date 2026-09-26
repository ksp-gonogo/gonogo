import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LandingStatusComponent } from "./index";

/**
 * The atmospheric-board stream render, with `bodyName` named from `vessel.identity.parentBodyIndex` against `system.bodies`.
 * `kerbin-reentry-atmospheric` descends through an atmosphere with no mod terminal velocity, so the vacuum burn numbers are suppressed and the estimate board (velocity, air density, drag-building note) shows instead of a silent "descent unmodelled".
 */
const CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.propulsion",
  "vessel.surface",
  "dv.summary",
  "comms.delay",
];

describe("LandingStatus: atmospheric stream render golden (delay=0)", () => {
  it("suppresses the vacuum burn numbers on the Kerbin reentry off the stream pipeline", async () => {
    registerStockBodies();
    const stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "landing-dual" }}>
          <LandingStatusComponent config={{}} id="landing-dual" w={8} h={10} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );

    act(() => {
      stream.emit("system.bodies", {
        bodies: [
          {
            name: "Kerbin",
            index: 1,
            parentIndex: 0,
            radius: 600_000,
            orbit: null,
          },
        ],
      });
      stream.emit("vessel.identity", {
        vesselId: "test-vessel",
        name: "Test Vessel",
        vesselType: 0,
        // SubOrbital, so the landed gate does not fire on an in-flight vessel.
        situation: 6,
        parentBodyIndex: 1,
        launchUt: null,
      });
      stream.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 1,
          sma: 700_000,
          ecc: 0.01,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 10,
          mu: 3.5316e12,
        },
        { quality: Quality.Loaded },
      );
      // Kerbin reentry: about 28 km AGL, descending 210 m/s, in atmosphere.
      stream.emit("vessel.flight", {
        latitude: 0,
        longitude: 0,
        altitudeAsl: 0,
        altitudeTerrain: 28000,
        verticalSpeed: -210.4,
        surfaceSpeed: 220,
        orbitalSpeed: 220,
        atmDensity: 0.087,
        atmosphericTemperature: 240.15,
        externalTemperature: 1850,
      });
    });

    // Atmospheric body: the subtitle names the body off vessel.identity.
    expect(
      await screen.findByText(/kerbin · atmospheric/i),
    ).toBeInTheDocument();
    // No terminal velocity on the wire gives the atmospheric estimate, never a silent "descent unmodelled".
    expect(
      screen.getByText("Atmospheric descent (estimate)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/descent unmodelled/i)).toBeNull();
    expect(screen.getByText(/drag building/i)).toBeInTheDocument();
    // The vacuum burn section stays suppressed (no drag solve to hedge).
    expect(screen.queryByText("Burn")).toBeNull();
    // The drag-independent velocity split renders (inside the estimate board).
    expect(screen.getByText("Horizontal")).toBeInTheDocument();
    expect(screen.queryByText("No landing in progress")).toBeNull();
  });
});
