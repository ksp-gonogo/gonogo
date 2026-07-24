import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LandingStatusComponent } from "./index";

/**
 * The rebooted LandingStatus runs a FULL-VECTOR suicide-burn solve — the burn
 * must null the whole surface-speed vector, not just the descent rate. These
 * tests drive real physics through a genuine `setupStreamFixture` pipeline
 * (real Mun/Kerbin body constants, `vessel.flight`/`vessel.propulsion`/
 * `vessel.orbit`) so the derived numbers are honest, and assert the correctness
 * fix at the DOM: a mostly-horizontal descent must NOT report a survivable
 * burn-now touchdown.
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
  "vessel.landing",
  "dv.summary",
  "comms.delay",
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
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    registerStockBodies();
    stream = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
  });

  function renderWidget(size?: { w: number; h: number }) {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "land" }}>
          <LandingStatusComponent
            config={{}}
            id="land"
            w={size?.w}
            h={size?.h}
          />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  it("shows the idle placeholder when no landing is in progress", async () => {
    renderWidget();
    act(() => {
      emitVessel(stream, { body: MUN, quality: Quality.OnRails });
    });
    expect(await screen.findByText(/vacuum/i)).toBeInTheDocument();
    expect(screen.getByText("No landing in progress")).toBeInTheDocument();
  });

  it("does NOT report a survivable burn-now touchdown when horizontal velocity dominates", async () => {
    renderWidget();
    act(() => {
      // The spec's worked Mun case: h=5km, descending 50 m/s but carrying
      // 540 m/s of (mostly horizontal) surface speed, aMax=20 m/s^2.
      // g≈1.63 -> horizontal≈538 m/s, best burn-now touchdown≈328 m/s (NOT 0),
      // and the burn no longer fits the remaining altitude (IGNITE now).
      emitVessel(stream, {
        body: MUN,
        quality: Quality.Loaded,
        descent: {
          heightFromTerrain: 5000,
          verticalSpeed: 50,
          surfaceSpeed: 540,
        },
        availableThrust: 20,
      });
    });

    // The horizontal component the old vertical-only model ignored is surfaced
    // in the velocity vector's accessible label.
    expect(
      await screen.findByRole("img", { name: /ground speed 538 m\/s/i }),
    ).toBeInTheDocument();
    // Burn-now touchdown is a large nonzero speed — the fatal-direction fix.
    expect(screen.getByText(/328 m\/s/)).toBeInTheDocument();
    // The burn no longer fits: ignite now, not a comfortable countdown.
    expect(screen.getByText("IGNITE")).toBeInTheDocument();
  });

  it("splits velocity into vertical and horizontal (the vector at a wide size)", async () => {
    renderWidget();
    act(() => {
      emitVessel(stream, {
        body: MUN,
        quality: Quality.Loaded,
        descent: {
          heightFromTerrain: 5000,
          verticalSpeed: 50,
          surfaceSpeed: 540,
        },
        availableThrust: 20,
      });
    });
    // At a wide size the split is the DescentScope velocity vector; its label
    // carries both components, horizontal (538) dominating the 50 m/s descent.
    expect(
      await screen.findByRole("img", {
        name: /descent 50 m\/s, ground speed 538 m\/s/i,
      }),
    ).toBeInTheDocument();
  });

  it("shows the plain vertical/horizontal split at a small size", async () => {
    renderWidget({ w: 4, h: 10 });
    act(() => {
      emitVessel(stream, {
        body: MUN,
        quality: Quality.Loaded,
        descent: {
          heightFromTerrain: 5000,
          verticalSpeed: 50,
          surfaceSpeed: 540,
        },
        availableThrust: 20,
      });
    });
    expect(await screen.findByText("Vertical")).toBeInTheDocument();
    expect(screen.getByText("Horizontal")).toBeInTheDocument();
    expect(screen.getByText(/538 m\/s/)).toBeInTheDocument();
  });

  it("uses the lowest-point altitude from vessel.surface, not the CoM altitude", async () => {
    // Small size renders the plain Height readout (km-formatted AGL).
    renderWidget({ w: 4, h: 10 });
    act(() => {
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
    expect(await screen.findByText(/2\.75 km/)).toBeInTheDocument();
    expect(screen.queryByText(/2\.80 km/)).toBeNull();
  });

  it("falls back to the CoM altitude when vessel.surface is absent", async () => {
    renderWidget({ w: 4, h: 10 });
    act(() => {
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
    expect(screen.getByText(/centre-of-mass/i)).toBeInTheDocument();
  });

  it("suppresses the vacuum burn numbers on atmospheric bodies", async () => {
    renderWidget();
    act(() => {
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
    expect(
      await screen.findByText(/kerbin · atmospheric/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/descent unmodelled/i)).toBeInTheDocument();
    // Vacuum burn/touchdown sections are suppressed, not hedged.
    expect(screen.queryByText("Burn")).toBeNull();
    expect(screen.queryByText("Touchdown")).toBeNull();
    // But the (drag-independent) velocity split still shows.
    expect(screen.getByText("Horizontal")).toBeInTheDocument();
  });

  it("shows the atmosphere-aware descent estimate when vessel.landing carries one", async () => {
    renderWidget();
    act(() => {
      emitVessel(stream, {
        body: KERBIN,
        quality: Quality.Loaded,
        descent: {
          heightFromTerrain: 3000,
          verticalSpeed: 80,
          surfaceSpeed: 85,
        },
      });
      // The mod-side terminal-velocity model, delivered on vessel.landing.
      stream.emit("vessel.landing", {
        outcome: "atmospheric-aware",
        terminalVelocity: 85,
        projectedTouchdownSpeed: 62,
        atmosphericTimeToImpact: 41.5,
        descentRegime: "at-terminal",
        parachuteState: "armed",
      });
    });
    expect(
      await screen.findByText("Atmospheric descent (estimate)"),
    ).toBeInTheDocument();
    expect(screen.getByText(/85.0 m\/s/)).toBeInTheDocument();
    expect(screen.getByText("at-terminal")).toBeInTheDocument();
    // The armed-chute caveat surfaces (terse); the unmodelled badge is gone.
    expect(screen.getByText(/excludes chute/i)).toBeInTheDocument();
    expect(screen.queryByText(/descent unmodelled/i)).toBeNull();
  });

  it("renders the touchdown reticle + hazard verdict at a large size", async () => {
    renderWidget({ w: 12, h: 14 });
    act(() => {
      emitVessel(stream, {
        body: MUN,
        quality: Quality.Loaded,
        descent: {
          heightFromTerrain: 3000,
          verticalSpeed: 30,
          surfaceSpeed: 40,
        },
        availableThrust: 20,
      });
      stream.emit("vessel.landing", {
        outcome: "terrain-assessed",
        sampleSource: "predicted",
        predictedLatitude: 0.5,
        predictedLongitude: 0.5,
        predictedSlopeAngle: 20, // > 15 => DIVERT
        predictedSlopeHeading: 135,
        predictedRoughness: 30,
        predictedBiome: "Highlands",
      });
    });
    expect(
      await screen.findByRole("img", { name: /touchdown site/i }),
    ).toBeInTheDocument();
    // The 20° slope trips a DIVERT verdict in a status banner.
    const statuses = screen.getAllByRole("status");
    expect(statuses.some((s) => /DIVERT/.test(s.textContent ?? ""))).toBe(true);
    // The source is surfaced honestly.
    expect(screen.getAllByText(/predicted/i).length).toBeGreaterThan(0);
  });

  it("shows the delayed regime banner off comms.delay", async () => {
    renderWidget();
    act(() => {
      emitVessel(stream, {
        body: MUN,
        quality: Quality.Loaded,
        descent: {
          heightFromTerrain: 5000,
          verticalSpeed: 50,
          surfaceSpeed: 540,
        },
        availableThrust: 20,
      });
      // SignalDelay source with a 4s one-way -> staged regime, RT 8s.
      stream.emit("comms.delay", { source: 1, oneWaySeconds: 4 });
    });
    expect(await screen.findByText("STAGED")).toBeInTheDocument();
  });

  it("exposes no command controls — Landing is an instrument, not a command surface", async () => {
    renderWidget();
    act(() => {
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
    await screen.findByText(/mun · vacuum/i);
    // Gear/brakes are fired from the operator's own action-group widgets; the
    // instrument itself must offer no toggle buttons.
    expect(screen.queryByRole("button", { name: /toggle gear/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /toggle brakes/i })).toBeNull();
  });

  it("escalates to role=alert when the burn is already committed (ignite now)", async () => {
    renderWidget();
    act(() => {
      // The worked Mun case: the burn no longer fits, so ignition is now — the
      // live-regime hero reads IGNITE and the section escalates to role=alert.
      emitVessel(stream, {
        body: MUN,
        quality: Quality.Loaded,
        descent: {
          heightFromTerrain: 5000,
          verticalSpeed: 50,
          surfaceSpeed: 540,
        },
        availableThrust: 20,
      });
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/IGNITE/);
  });

  it("has no axe violations", async () => {
    const { container } = renderWidget();
    act(() => {
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
      stream.emit("vessel.control", { gear: false, brakes: false });
    });
    await screen.findByRole("img", { name: /descent/i });
    expect(await axe(container)).toHaveNoViolations();
  });
});
