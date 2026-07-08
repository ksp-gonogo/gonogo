import { clearActionHandlers, DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { DistanceToTargetComponent } from "./index";

/**
 * The M3 vessel-gap batch's stream test-adapter proof for DistanceToTarget:
 * genuinely running off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport`. `tar.distance`/
 * `tar.o.relativeVelocity`/`dock.x`/`dock.y`/`dock.ax`/`dock.ay` themselves
 * stay GAPPED (map-topic.ts) — what's actually mapped is the raw
 * `vessel.target`/`vessel.dock` Vec3 fields (`tar.relativePosition`/
 * `tar.relativeVelocityVec`/`dock.relativePosition`/
 * `dock.relativeVelocityVec`/`dock.distanceScalar`/`dock.forwardDot`), which
 * the widget derives the legacy-shaped scalars/angles from client-side
 * (`vecMagnitude`/`radialSpeed`/`deriveDockAngles` in index.tsx). `tar.name`/
 * `tar.type` stay legacy-only (still-gapped) throughout — a small
 * `setupMockDataSource` AUX carries just those two, the same MIXED-source
 * shape CurrentOrbit's own M3 batch-2 migration established.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("DistanceToTarget — genuinely runs off the stream (M3 vessel-gap batch)", () => {
  it("renders tracking-mode distance/closing-rate derived from vessel.target's Vec3 fields", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.target"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "tar.name" }, { key: "tar.type" }],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "dtt-stream" }}>
          <DistanceToTargetComponent id="dtt-stream" w={6} h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(screen.getByText("No target set in KSP")).toBeTruthy();
    expect(fixture.transport.isSubscribed("vessel.target")).toBe(true);

    act(() => {
      legacyAux.source.emit("tar.name", "Stream Station");
      legacyAux.source.emit("tar.type", "Vessel");
      // Magnitude of (6000, 0, 8000) = 10000 m; dot((6000,0,8000),(30,0,40))
      // = 500000 > 0 -> opening, relVel = 500000 / 10000 = 50.
      fixture.emit("vessel.target", {
        name: "Stream Station",
        kind: 0,
        vesselId: "target-vessel",
        bodyIndex: null,
        relativePosition: { x: 6000, y: 0, z: 8000 },
        relativeVelocity: { x: 30, y: 0, z: 40 },
      });
    });

    await waitFor(() => expect(screen.getByText("10.0 km")).toBeTruthy());
    expect(screen.getByText("Δv 50.00 m/s")).toBeTruthy();

    teardownMockDataSource(legacyAux);
  });

  it("derives docking-HUD alignment angles + forwardDot from vessel.dock", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.target", "vessel.dock"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "tar.name" }, { key: "tar.type" }],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "dtt-dock" }}>
          <DistanceToTargetComponent id="dtt-dock" w={12} h={10} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("tar.name", "Docking Port Mk2");
      legacyAux.source.emit("tar.type", "Vessel");
      // Close range (< HUD_ENTER_M) to force docking-hud mode.
      fixture.emit("vessel.target", {
        name: "Docking Port Mk2",
        kind: 0,
        vesselId: "target-vessel",
        bodyIndex: null,
        relativePosition: { x: 0, y: 0, z: 62 },
        relativeVelocity: { x: 0, y: 0, z: -0.4 },
      });
      fixture.emit("vessel.dock", {
        relativePosition: { x: 2, y: -1.5, z: 40 },
        relativeVelocity: { x: 0, y: 0, z: -0.40078 },
        distance: 62,
        forwardDot: 0.9999,
      });
    });

    await waitFor(() =>
      expect(
        screen.getByRole("region", {
          name: "Docking HUD for Docking Port Mk2",
        }),
      ).toBeTruthy(),
    );
    // atan2(2, 40) * 180/π ≈ 2.9°; atan2(-1.5, 40) * 180/π ≈ -2.1°; no az
    // stream field exists at all -> stays "—".
    expect(screen.getByText("2.9° · -2.1° · —")).toBeTruthy();
    // vessel.dock.distance (62) headlines the HUD in preference to the
    // general tar.distance figure.
    expect(screen.getByText("62 m")).toBeTruthy();

    teardownMockDataSource(legacyAux);
  });
});
