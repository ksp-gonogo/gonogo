import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LandingStatusComponent } from "./index";

/**
 * LandingStatus's atmospheric-board stream render golden. This began life as a
 * legacy-`DataSource`↔stream byte-identical dual-run; `bodyName` now comes off
 * the real, client-derived `vessel.state` channel and the body's atmosphere
 * flag / radius come from the static stock-body registry (`getBody`), with NO
 * legacy fallback at all (see `stream.test.tsx`).
 *
 * The `kerbin-reentry-atmospheric` fixture is a descent on an ATMOSPHERIC body
 * with NO mod terminal-velocity read on the wire. The widget suppresses the
 * (wrong-for-atmosphere) vacuum burn numbers but shows an HONEST estimate board
 *, velocity + air density + an above-terminal / drag-building note, rather
 * than a silent "descent unmodelled". This proves that gate fires off the real
 * stream pipeline. (When the mod DOES ship a terminal velocity, the fuller
 * atmospheric-aware board shows instead, see the render fixtures.)
 */
const CARRIED = [
  "vessel.state",
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
        // Reentering (descending), not landed: situation SubOrbital, so the
        // landed-state gate doesn't fire on an in-flight vessel.
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
      // Kerbin reentry: ~28 km AGL, descending 210 m/s, in atmosphere. (Literals
      //, the __fixtures__ scenario JSON migrated to the _stream format and no
      // longer exposes the old flat `v.*` keys this test used to read.)
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

    // Atmospheric body: subtitle resolves off the derived vessel.state channel.
    expect(
      await screen.findByText(/kerbin · atmospheric/i),
    ).toBeInTheDocument();
    // No mod terminal velocity on the wire -> an HONEST atmospheric estimate
    // (velocity + air density + above-terminal note), never a silent "descent
    // unmodelled". A real in-atmosphere descent must not read blank.
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
