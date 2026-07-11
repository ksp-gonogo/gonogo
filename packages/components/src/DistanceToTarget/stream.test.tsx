import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { DistanceToTargetComponent } from "./index";

/**
 * DistanceToTarget's stream test-adapter proof: genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport`. The widget derives EVERY scalar/angle it renders
 * client-side from the `vessel.target`/`vessel.dock` Vec3 fields
 * (`tar.relativePosition`/`tar.relativeVelocityVec`/`dock.relativePosition`/
 * `dock.relativeVelocityVec`/`dock.distanceScalar`/`dock.forwardDot`) —
 * `vecMagnitude`/`radialSpeed`/`deriveDockAngles` in index.tsx — with no
 * legacy `tar.distance`/`tar.o.relativeVelocity`/`dock.x`/`dock.y`/`dock.ax`/
 * `dock.ay` scalar reads at all, and the docking roll/az axis dropped
 * outright (renders "—"). `tar.name` rides `vessel.target.name`; `tar.type`
 * maps to the DERIVED `vessel.state.targetKind`, which isn't carried here, so
 * a small `setupMockDataSource` AUX still supplies the target kind (its
 * `vessel.state` inputs would otherwise all have to be carried + emitted).
 * The TCA test additionally reads the SDK view-UT via `useViewUt` — the
 * replacement for the dropped `t.universalTime` data key.
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

  it("M3 whole-branch review #4: degrades correctly (not stale) when the target is cleared — vessel.target present -> null tombstone", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.target"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "tar.name" }, { key: "tar.type" }],
      connectSource: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "dtt-cleared" }}>
          <DistanceToTargetComponent id="dtt-cleared" w={6} h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      // `tar.name` is itself mapped (-> vessel.target.name — a raw-field
      // subtopic of the SAME `vessel.target` record `tar.relativePosition`
      // reads), so this legacy emit is a decoy: once the stream carries a
      // real `vessel.target` payload, it wins. It stays here, unchanged,
      // for the rest of the test — proving the widget does NOT fall back
      // to this stale legacy name once the target is cleared on the wire.
      legacyAux.source.emit("tar.name", "Rendezvous Target");
      legacyAux.source.emit("tar.type", "Vessel");
      fixture.emit("vessel.target", {
        name: "Rendezvous Target",
        kind: 0,
        vesselId: "target-vessel",
        bodyIndex: null,
        relativePosition: { x: 6000, y: 0, z: 8000 },
        relativeVelocity: { x: 30, y: 0, z: 40 },
      });
    });

    await waitFor(() => expect(screen.getByText("10.0 km")).toBeTruthy());
    expect(screen.getByText("Rendezvous Target")).toBeTruthy();

    // Target cleared in KSP — the mod publishes a tombstone (payload: null)
    // for the whole `vessel.target` record, not merely an absent field.
    act(() => {
      fixture.emit("vessel.target", null);
    });

    await waitFor(() => {
      if (container.textContent?.includes("SYNCING")) {
        throw new Error("stream status has not settled to live yet");
      }
      expect(screen.getByText("No target set in KSP")).toBeTruthy();
    });
    // Must NOT still show the stale distance/name from before the clear —
    // a real regression here would silently keep rendering "10.0 km" /
    // "Rendezvous Target" forever (the tombstone read as "not arrived yet"
    // instead of "confirmed absence", or the stale legacy value winning).
    expect(screen.queryByText("10.0 km")).toBeNull();
    expect(screen.queryByText("Rendezvous Target")).toBeNull();

    teardownMockDataSource(legacyAux);
  });

  it("renders approach-mode TCA from o.closestTgtApprUT and the SDK view-UT", async () => {
    // pinnedUt fixes the view clock at UT 1000 — the value `useViewUt`
    // returns in place of the dropped `t.universalTime` data key.
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.target"],
      pinnedUt: 1000,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [
        { key: "tar.name" },
        { key: "tar.type" },
        { key: "o.closestTgtApprUT" },
      ],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "dtt-tca" }}>
          <DistanceToTargetComponent id="dtt-tca" w={6} h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("tar.name", "Rendezvous Target");
      legacyAux.source.emit("tar.type", "Vessel");
      // closest approach at UT 1125 → 125 s from the pinned view-UT (1000) →
      // T−02:05.
      legacyAux.source.emit("o.closestTgtApprUT", 1125);
      // 2000 m puts the widget in approach mode (100 m – 5 km); z-only Vec3
      // so |relPos| = 2000 and the radial rate is −5 (closing).
      fixture.emit("vessel.target", {
        name: "Rendezvous Target",
        kind: 0,
        vesselId: "target-vessel",
        bodyIndex: null,
        relativePosition: { x: 0, y: 0, z: 2000 },
        relativeVelocity: { x: 0, y: 0, z: -5 },
      });
    });

    await waitFor(() => expect(screen.getByText("APPROACH")).toBeTruthy());
    expect(screen.getByText(/T−02:05/)).toBeTruthy();

    teardownMockDataSource(legacyAux);
  });
});
