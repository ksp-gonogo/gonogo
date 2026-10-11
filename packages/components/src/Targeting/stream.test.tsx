import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TargetingComponent } from "./index";

/**
 * Targeting running off the real stream pipeline via `StubTransport`. Every
 * scalar and angle is derived client-side from the `vessel.target` and
 * `vessel.dock` Vec3 fields; docking roll is not on the wire and renders the
 * null placeholder.
 */
afterEach(() => {
  clearActionHandlers();
});

describe("Targeting: genuinely runs off the stream", () => {
  it("renders tracking-mode distance/closing-rate derived from vessel.target's Vec3 fields", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "dtt-stream" }}>
          <TargetingComponent id="dtt-stream" w={6} h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Pending, not a confirmed absence.
    expect(screen.getByText("Waiting for target telemetry")).toBeTruthy();
    expect(fixture.transport.isSubscribed("vessel.target")).toBe(true);

    act(() => {
      // |(6000, 0, 8000)| = 10000 m; the dot product is positive, so opening at 50 m/s.
      fixture.emit("vessel.target", {
        name: "Stream Station",
        kind: 0,
        vesselId: "target-vessel",
        bodyIndex: null,
        relativePosition: { x: 6000, y: 0, z: 8000 },
        relativeVelocity: { x: 30, y: 0, z: 40 },
      });
    });

    await waitFor(() => expect(visibleText()).toContain("10.0 km"));
    expect(visibleText()).toContain("Δv 50.00 m/s");
  });

  it("derives docking-HUD alignment angles + forwardDot from vessel.dock", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "dtt-dock" }}>
          <TargetingComponent id="dtt-dock" w={12} h={10} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      // Under HUD_ENTER_M, forcing docking-hud mode.
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
    // atan2(2, 40) ≈ 2.9° and atan2(-1.5, 40) ≈ -2.1°, each through `<Unit>`; no roll field exists.
    expect(visibleText()).toContain(`2.9° · -2.1° · ${NULL_DISPLAY}`);
    // The dock distance headlines the HUD, on the `length` ladder.
    expect(visibleText()).toContain("62.0 m");
  });

  it("degrades correctly (not stale) when the target is cleared, vessel.target present -> null tombstone", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "dtt-cleared" }}>
          <TargetingComponent id="dtt-cleared" w={6} h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.target", {
        name: "Rendezvous Target",
        kind: 0,
        vesselId: "target-vessel",
        bodyIndex: null,
        relativePosition: { x: 6000, y: 0, z: 8000 },
        relativeVelocity: { x: 30, y: 0, z: 40 },
      });
    });

    await waitFor(() => expect(visibleText()).toContain("10.0 km"));
    expect(screen.getByText("Rendezvous Target")).toBeTruthy();

    // Target cleared: a tombstone for the whole `vessel.target` record.
    act(() => {
      fixture.emit("vessel.target", null);
    });

    await waitFor(() => {
      if (visibleText(container).includes("SYNCING")) {
        throw new Error("stream status has not settled to live yet");
      }
      expect(screen.getByText("No target set in KSP")).toBeTruthy();
    });
    // The stale distance and name must not survive the clear.
    expect(screen.queryByText("10.0 km")).toBeNull();
    expect(screen.queryByText("Rendezvous Target")).toBeNull();
  });

  it("renders approach-mode TCA from vessel.target.closestApproach and the SDK view-UT", async () => {
    // The pinned view clock is UT 1000.
    const fixture = setupStreamFixture({
      pinnedUt: 1000,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "dtt-tca" }}>
          <TargetingComponent id="dtt-tca" w={6} h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      // 2000 m is approach mode, closing at 5 m/s; closest approach at UT 1125 is 125 s from the view-UT.
      fixture.emit("vessel.target", {
        name: "Rendezvous Target",
        kind: 0,
        vesselId: "target-vessel",
        bodyIndex: null,
        relativePosition: { x: 0, y: 0, z: 2000 },
        relativeVelocity: { x: 0, y: 0, z: -5 },
        closestApproach: { time: 1125, distance: 0 },
      });
    });

    await waitFor(() => expect(screen.getByText("APPROACH")).toBeTruthy());
    expect(visibleText()).toMatch(/T−2min 5s/);
  });
});
