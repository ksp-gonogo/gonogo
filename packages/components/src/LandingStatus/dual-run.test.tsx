import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import kerbinReentry from "./__fixtures__/kerbin-reentry-atmospheric.json";
import { LandingStatusComponent } from "./index";

/**
 * LandingStatus's atmospheric-board stream render golden. This began life as a
 * legacy-`DataSource`↔stream byte-identical dual-run; `bodyName` now comes off
 * the real, client-derived `vessel.state` channel and the body's atmosphere
 * flag / radius come from the static stock-body registry (`getBody`), with NO
 * legacy fallback at all (see `stream.test.tsx`).
 *
 * The `kerbin-reentry-atmospheric` fixture is a descent on an ATMOSPHERIC body.
 * The rebooted widget has no drag model, so on atmospheric bodies it SUPPRESSES
 * the vacuum burn/touchdown numbers entirely (rather than hedge a wrong one) and
 * shows the "descent unmodelled" note. This proves that whole gate fires off the
 * real stream pipeline.
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

describe("LandingStatus — atmospheric stream render golden (delay=0)", () => {
  it("suppresses the vacuum burn numbers on the Kerbin reentry off the stream pipeline", async () => {
    registerStockBodies();
    const stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
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
        situation: 0,
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
      stream.emit("vessel.flight", {
        latitude: 0,
        longitude: 0,
        altitudeAsl: 0,
        altitudeTerrain: kerbinReentry["v.heightFromTerrain"],
        verticalSpeed: kerbinReentry["v.verticalSpeed"],
        surfaceSpeed: 220,
        orbitalSpeed: 220,
        atmDensity: kerbinReentry["v.atmosphericDensity"],
        atmosphericTemperature: kerbinReentry["v.atmosphericTemperature"],
        externalTemperature: kerbinReentry["v.externalTemperature"],
      });
    });

    // Atmospheric body — subtitle resolves off the derived vessel.state channel.
    expect(
      await screen.findByText(/kerbin · atmospheric/i),
    ).toBeInTheDocument();
    // No drag model -> the vacuum numbers are suppressed with a visible note.
    expect(screen.getByText(/descent unmodelled/i)).toBeInTheDocument();
    // The burn/touchdown sections are gone, not merely muted.
    expect(screen.queryByText("Burn")).toBeNull();
    expect(screen.queryByText("Touchdown")).toBeNull();
    // But the drag-independent velocity split still renders.
    expect(screen.getByText("Horizontal")).toBeInTheDocument();
    expect(screen.queryByText("No landing in progress")).toBeNull();
  });
});
