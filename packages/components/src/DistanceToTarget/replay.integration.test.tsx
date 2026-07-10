import { DashboardItemContext } from "@ksp-gonogo/core";
import { synthesizeFlight } from "@ksp-gonogo/data";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ReplayDataSourceFixture,
  setupReplayDataSource,
  stepwise,
  teardownReplayDataSource,
} from "../test/setupReplayDataSource";
import { DistanceToTargetComponent } from "./index";

/**
 * Demo: drive DistanceToTarget through a full docking-approach sequence.
 * The widget has three modes (tracking / approach / docking-hud) gated by the
 * derived target distance (`|tar.relativePosition|`) with hysteresis at 100m /
 * 150m / 5000m / 5500m. A synthesized fixture is the natural way to exercise
 * every transition — including a tricky one (the small post-HUD distance
 * bump) — without scripting per-emit timing by hand.
 *
 * Post-R6 the widget reads the `vessel.target`/`vessel.dock` Vec3 fields, not
 * the legacy scalar keys. Ranges/rates are laid out purely along z so
 * `|relativePosition| = z` and the derived radial rate === the z-velocity.
 */

const APPROACH = synthesizeFlight({
  vesselName: "Approach Test",
  launchedAt: 1_700_000_000_000,
  samples: {
    "v.name": [[0, "Approach Test"]],
    "v.missionTime": [
      [0, 0],
      [10_000, 10],
      [30_000, 30],
      [45_000, 45],
      [50_000, 50],
      [60_000, 60],
    ],
    "tar.name": [[0, "Hubble Mk II"]],
    "tar.type": [[0, "Vessel"]],
    "tar.relativePosition": [
      [0, { x: 0, y: 0, z: 5_000 }], // approach-mode boundary
      [10_000, { x: 0, y: 0, z: 1_500 }], // mid-approach
      [30_000, { x: 0, y: 0, z: 200 }], // still in approach (>150 hysteresis floor)
      [45_000, { x: 0, y: 0, z: 80 }], // crosses the 100m HUD-enter threshold → HUD
      [50_000, { x: 0, y: 0, z: 130 }], // drifts back — between exit (150m) and enter (100m).
      //                                // Hysteresis must keep mode in HUD.
      [60_000, { x: 0, y: 0, z: 30 }], // settled deep in HUD
    ],
    "tar.relativeVelocityVec": [
      [0, { x: 0, y: 0, z: -25 }],
      [10_000, { x: 0, y: 0, z: -5 }],
      [30_000, { x: 0, y: 0, z: -1.5 }],
      [45_000, { x: 0, y: 0, z: -0.8 }],
      [50_000, { x: 0, y: 0, z: 0.3 }], // briefly opening
      [60_000, { x: 0, y: 0, z: -0.2 }],
    ],
    "dock.relativePosition": [
      [45_000, { x: 0.4, y: -0.3, z: 80 }],
      [50_000, { x: 0.5, y: -0.4, z: 130 }],
      [60_000, { x: 0.05, y: -0.02, z: 30 }],
    ],
    "dock.distanceScalar": [
      [45_000, 80],
      [50_000, 130],
      [60_000, 30],
    ],
  },
});

describe("DistanceToTarget — integration via FlightReplayDataSource", () => {
  let fixture: ReplayDataSourceFixture;

  beforeEach(async () => {
    fixture = await setupReplayDataSource({ fixture: APPROACH });
  });

  afterEach(() => {
    teardownReplayDataSource(fixture);
  });

  function renderTarget() {
    return render(
      <DashboardItemContext.Provider value={{ instanceId: "dtt-replay" }}>
        <DistanceToTargetComponent
          config={{ autoSwitch: true, hudMode: "hud" }}
          id="dtt-replay"
          w={6}
          h={5}
        />
      </DashboardItemContext.Provider>,
    );
  }

  it("shows the no-target placeholder before any telemetry arrives", async () => {
    renderTarget();
    expect(await screen.findByText(/no target set/i)).toBeInTheDocument();
  });

  it("opens in tracking mode at >5km, shows the target name + distance", async () => {
    renderTarget();
    // advanceStepwise yields between samples so the widget's mode-driving
    // useEffect runs once per sample (matching real-time playback).
    await stepwise(fixture, 5_000);
    expect(await screen.findByText("TARGET")).toBeInTheDocument();
    expect(screen.getByText(/Hubble Mk II/)).toBeInTheDocument();
    expect(screen.getByText(/5\.0 km/)).toBeInTheDocument();
  });

  it("transitions tracking → approach as distance drops below 5km", async () => {
    renderTarget();
    await stepwise(fixture, 11_000); // tar.distance = 1500m
    expect(await screen.findByText("APPROACH")).toBeInTheDocument();
    expect(screen.getByText(/Closing rate/)).toBeInTheDocument();
    expect(screen.getByText(/5\.0 m\/s/)).toBeInTheDocument();
  });

  it("transitions approach → docking-hud as distance crosses 100m", async () => {
    renderTarget();
    await stepwise(fixture, 46_000); // tar.distance = 80m
    await waitFor(() => {
      expect(screen.queryByText("APPROACH")).toBeNull();
      expect(screen.queryByText("TARGET")).toBeNull();
    });
  });

  it("hysteresis keeps mode in HUD when distance drifts back to 130m", async () => {
    renderTarget();
    // The fixture crosses 80m → 130m → 30m. Without stepwise advance the
    // intermediate 80m emission would batch with 130m and the widget
    // would never enter HUD mode in the first place — exactly the bug
    // this helper is here to prevent.
    await stepwise(fixture, 51_000);
    await waitFor(() => {
      expect(screen.queryByText("APPROACH")).toBeNull();
    });
  });

  it("settles back into HUD at 30m by the end of the approach", async () => {
    renderTarget();
    await stepwise(fixture, fixture.replay.duration());
    await waitFor(() => {
      expect(screen.queryByText("APPROACH")).toBeNull();
      expect(screen.queryByText("TARGET")).toBeNull();
    });
  });
});
