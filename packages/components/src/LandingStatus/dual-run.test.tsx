import { registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import kerbinReentry from "./__fixtures__/kerbin-reentry-atmospheric.json";
import { LandingStatusComponent } from "./index";

/**
 * LandingStatus's stream render golden. This began life as a
 * legacy-`DataSource`↔stream byte-identical dual-run; `bodyName` and every
 * ballistic `land.*` scalar now come off the real, client-derived
 * `vessel.state` channel with NO legacy fallback at all (see
 * `stream.test.tsx`) — same "the legacy leg is gone" story as
 * `WarpControl/dual-run.test.tsx`'s own doc comment. What remains proves the
 * widget renders the full Kerbin-reentry state correctly off the real
 * stream pipeline, using the SAME `kerbin-reentry-atmospheric` fixture the
 * DOM-snapshot suite covers for its ambient (`v.atmosphericDensity`/
 * `v.atmosphericTemperature`/`v.externalTemperature`) values — those three
 * are unchanged, direct `vessel.flight.*` reads. `land.slopeAngle` is the
 * one key with no wire home at all (`index.tsx`'s own comment) — it stays
 * on a legacy AUX.
 *
 * The fixture carries no propulsion data (a passive reentry, no active
 * burn), so `bestSpeedAtImpact`/`suicideBurnCountdown` stay null here — a
 * real, honest gap for a scenario with no engine input, not a test
 * omission.
 */
describe("LandingStatus — stream render golden (delay=0)", () => {
  it("renders the full Kerbin-reentry state off the stream pipeline", async () => {
    registerStockBodies();
    const stream = setupStreamFixture({
      carriedChannels: [
        "vessel.orbit",
        "vessel.flight",
        "vessel.identity",
        "system.bodies",
        "vessel.control",
        "vessel.target",
        "vessel.comms",
        "vessel.propulsion",
      ],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      keys: [{ key: "land.slopeAngle" }],
    });

    const { container } = render(
      <stream.Provider>
        <LandingStatusComponent config={{}} id="landing-dual" w={8} h={10} />
      </stream.Provider>,
    );

    act(() => {
      legacyAux.source.emit(
        "land.slopeAngle",
        kerbinReentry["land.slopeAngle"],
      );
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

    await waitFor(() => {
      if (!container.textContent?.includes("87.00 g/m³")) {
        throw new Error("stream leg has not rendered live air density yet");
      }
    });

    // Atmospheric body — subtitle + suicide-row aerobraking note.
    expect(screen.getByText(/kerbin · atmospheric/i)).toBeInTheDocument();
    expect(screen.getByText(/aerobraking/i)).toBeInTheDocument();
    // g = mu/radius² = 9.81 m/s² -> timeToImpact ≈ 57.1s, speedAtImpact ≈
    // 773 m/s — no propulsion emitted (a passive reentry), so the
    // burn-dependent fields stay null/"—" (SuicideValue), but the full
    // grid is clear of the empty state.
    expect(screen.getByText(/773 m\/s/)).toBeInTheDocument();
    expect(screen.queryByText("No landing in progress")).toBeNull();
    expect(
      screen.queryByText("Waiting for a landing prediction..."),
    ).toBeNull();
    // The gapped slope key still reads off the legacy AUX.
    expect(screen.getByText(/0\.3°/)).toBeInTheDocument();

    teardownMockDataSource(legacyAux);
  });
});
