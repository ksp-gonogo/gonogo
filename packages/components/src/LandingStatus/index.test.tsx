import { registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LandingStatusComponent } from "./index";

/**
 * `bodyName`/the four ballistic `land.*` scalars all come off the real,
 * client-derived `vessel.state`/`vessel.state.landing*` channel now (see
 * `stream.test.tsx`) — no legacy fallback exists for them at all, so this
 * drives them through a genuine `setupStreamFixture` pipeline instead of
 * declaring the derived numbers directly. `land.slopeAngle` is the ONE key
 * left with no wire home (`index.tsx`'s own comment: "needs a terrain
 * heightmap this client derivation has no source for") — that's the one
 * field still worth a legacy `MockDataSource`.
 *
 * Real Mun (radius 200_000m, mu 6.5138398e10 — `packages/core/src/
 * stock-bodies.ts`) and Kerbin (radius 600_000m, mu 3.5316e12,
 * hasAtmosphere) constants drive the physics below so the derived numbers
 * are genuine, not fabricated — see each test's own comment for the
 * resulting values.
 */
const CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
  "vessel.surface",
];

const MUN = { index: 3, name: "Mun", radius: 200_000, mu: 6.5138398e10 };
const KERBIN = { index: 1, name: "Kerbin", radius: 600_000, mu: 3.5316e12 };

function emitVessel(
  stream: ReturnType<typeof setupStreamFixture>,
  opts: {
    body: { index: number; name: string; radius: number; mu: number };
    quality: number;
    descent?: {
      heightFromTerrain: number;
      verticalSpeed: number;
      surfaceSpeed: number;
    };
    availableThrust?: number;
  },
) {
  stream.emit("system.bodies", {
    bodies: [
      {
        name: opts.body.name,
        index: opts.body.index,
        parentIndex: 0,
        radius: opts.body.radius,
        orbit: null,
      },
    ],
  });
  stream.emit("vessel.identity", {
    vesselId: "test-vessel",
    name: "Test Vessel",
    vesselType: 0,
    situation: 0,
    parentBodyIndex: opts.body.index,
    launchUt: null,
  });
  stream.emit(
    "vessel.orbit",
    {
      referenceBodyIndex: opts.body.index,
      sma: 250_000,
      ecc: 0.01,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 10,
      mu: opts.body.mu,
    },
    { quality: opts.quality },
  );
  if (opts.descent) {
    stream.emit("vessel.flight", {
      latitude: 0,
      longitude: 0,
      altitudeAsl: 0,
      altitudeTerrain: opts.descent.heightFromTerrain,
      verticalSpeed: -opts.descent.verticalSpeed,
      surfaceSpeed: opts.descent.surfaceSpeed,
      orbitalSpeed: opts.descent.surfaceSpeed,
      atmDensity: 0,
    });
  }
  if (opts.availableThrust !== undefined) {
    stream.emit("vessel.propulsion", {
      totalMass: 1,
      dryMass: 0.5,
      currentThrust: 0,
      availableThrust: opts.availableThrust,
    });
  }
}

describe("LandingStatusComponent", () => {
  let slopeFixture: MockDataSourceFixture;
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(async () => {
    registerStockBodies();
    slopeFixture = await setupMockDataSource({
      keys: [{ key: "land.slopeAngle" }],
    });
    stream = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
  });

  afterEach(() => {
    teardownMockDataSource(slopeFixture);
  });

  function renderWidget() {
    return render(
      <stream.Provider>
        <LandingStatusComponent config={{}} id="land" />
      </stream.Provider>,
    );
  }

  it("shows the idle placeholder when no landing is in progress", async () => {
    renderWidget();
    act(() => {
      // OnRails (default quality) -> the propagated basis, which never
      // computes the landing scalars at all (see vessel-state.ts).
      emitVessel(stream, { body: MUN, quality: Quality.OnRails });
    });
    // The empty state is already showing before the pinned view-clock's
    // first frame tick lands (it's the safe default), so wait on the
    // subtitle — which only appears once `vessel.state` has actually
    // resolved — rather than the trivially-already-true empty-state text.
    expect(await screen.findByText(/vacuum/i)).toBeInTheDocument();
    // Body subtitle notes vacuum, and the empty state still shows (no
    // landing scalars in the propagated basis).
    expect(screen.getByText("No landing in progress")).toBeInTheDocument();
  });

  it("renders the full readout when a prediction lands", async () => {
    renderWidget();
    act(() => {
      // Mun, Loaded/measured basis: g = mu/radius² ≈ 1.6285 m/s².
      // h=2800m, vDown=42.5 m/s, surfaceSpeed=50 m/s ->
      //   timeToImpact ≈ 38.09s, speedAtImpact ≈ 107.79 m/s (-> "108 m/s").
      // availableThrust=3 (aMax=3, TWR ≈ 1.84 over g) ->
      //   burn distance (658m) fits within 2800m -> bestSpeedAtImpact = 0,
      //   suicideBurnCountdown ≈ 31.4s (not urgent — stays role=status).
      emitVessel(stream, {
        body: MUN,
        quality: Quality.Loaded,
        descent: {
          heightFromTerrain: 2800,
          verticalSpeed: 42.5,
          surfaceSpeed: 50,
        },
        availableThrust: 3,
      });
      slopeFixture.source.emit("land.slopeAngle", 4.2);
    });

    expect(await screen.findByText(/T−/)).toBeInTheDocument();
    expect(screen.getByText(/108 m\/s/)).toBeInTheDocument();
    expect(screen.getByText(/best 0\.00 m\/s/)).toBeInTheDocument();
    expect(screen.getByText(/2\.80 km/)).toBeInTheDocument();
    expect(screen.getByText(/4\.2°/)).toBeInTheDocument();
    // Non-urgent countdown (~31s) — status (polite), not alert.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("escalates to role=alert when the suicide-burn countdown drops below 5s", async () => {
    renderWidget();
    act(() => {
      // Mun, h=500m, vDown=60 m/s, availableThrust=5.3 (aMax ≈ 5.3, tuned so
      // the burn-start altitude sits only ~10m above current height) ->
      // suicideBurnCountdown ≈ 0.16s — well inside the urgent (0, 5] window.
      emitVessel(stream, {
        body: MUN,
        quality: Quality.Loaded,
        descent: {
          heightFromTerrain: 500,
          verticalSpeed: 60,
          surfaceSpeed: 60,
        },
        availableThrust: 5.3,
      });
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/T−/);
  });

  it("shows the lowest-point altitude from vessel.surface, not the CoM altitude", async () => {
    renderWidget();
    act(() => {
      // vessel.flight.altitudeTerrain is KSP's CoM-to-ground radarAltitude
      // (2800m here); vessel.surface.heightFromTerrain is the lowest-point
      // reading (2755m — the craft is 45m tall). The Altitude row must show
      // the lowest-point number, the one a landing actually cares about.
      emitVessel(stream, {
        body: MUN,
        quality: Quality.Loaded,
        descent: {
          heightFromTerrain: 2800,
          verticalSpeed: 42.5,
          surfaceSpeed: 50,
        },
        availableThrust: 3,
      });
      stream.emit("vessel.surface", {
        biome: "Highlands",
        landedAt: null,
        heightFromTerrain: 2755,
      });
    });

    // 2.75 km (lowest-point) shows; the 2.80 km CoM reading does not.
    expect(await screen.findByText(/2\.75 km/)).toBeInTheDocument();
    expect(screen.queryByText(/2\.80 km/)).toBeNull();
  });

  it("falls back to the CoM altitude when vessel.surface is absent", async () => {
    renderWidget();
    act(() => {
      // No vessel.surface emitted (nulled by the mod while far from terrain) —
      // the Altitude row falls back to vessel.flight.altitudeTerrain.
      emitVessel(stream, {
        body: MUN,
        quality: Quality.Loaded,
        descent: {
          heightFromTerrain: 2800,
          verticalSpeed: 42.5,
          surfaceSpeed: 50,
        },
        availableThrust: 3,
      });
    });

    expect(await screen.findByText(/2\.80 km/)).toBeInTheDocument();
  });

  it("flags atmospheric bodies and demotes the suicide-burn row", async () => {
    renderWidget();
    act(() => {
      // Kerbin (hasAtmosphere) — any positive height/descent gives a
      // finite timeToImpact, clearing noPrediction so the subtitle +
      // suicide-row aerobraking note both render.
      emitVessel(stream, {
        body: KERBIN,
        quality: Quality.Loaded,
        descent: {
          heightFromTerrain: 3000,
          verticalSpeed: 80,
          surfaceSpeed: 220,
        },
      });
    });

    // Subtitle mentions atmospheric, and the suicide-burn row's caveat note
    // mentions aerobraking. Both should be on-screen.
    expect(
      await screen.findByText(/kerbin · atmospheric/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/aerobraking/i)).toBeInTheDocument();
  });
});
