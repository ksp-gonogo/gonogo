import {
  clearAugments,
  DashboardItemContext,
  registerAugment,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installRendezvousBox } from "../test/rendezvousBox";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { RendezvousComponent } from "./index";

/**
 * Mode transitions and the docking gate through the stream pipeline. Distance,
 * closing rate and docking angles are derived client-side from the Vec3
 * fields, so the tests feed those directly. Assertions after an emit sit in
 * `waitFor`, since a streamed value lands on an animation frame.
 */

/** Vec3 purely along z, so `|relativePosition|` (the mode driver) === `d`. */
function atRange(d: number) {
  return { x: 0, y: 0, z: d };
}

/** A `tar.type` string to its `vessel.target.kind` ordinal. */
const KIND: Record<string, number> = { Vessel: 0, CelestialBody: 1 };

// Unmounted before clearAugments(), whose notification on a mounted AugmentSlot lands outside act().
const renderedTrees: Array<() => void> = [];

let restoreBox: (() => void) | undefined;

beforeEach(() => {
  restoreBox = installRendezvousBox();
});

afterEach(() => {
  restoreBox?.();
});

/** The Docking level's circle, as the circle group named for it. */
const dockingCircle = () =>
  screen.getByRole("group", { name: "Docking level" });
const queryDockingCircle = () =>
  screen.queryByRole("group", { name: "Docking level" });

function renderWidget(
  fixture: StreamFixture,
  config: Record<string, unknown> = {},
  props: { id?: string; w?: number; h?: number } = {},
) {
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: props.id ?? "tar" }}>
        <RendezvousComponent
          config={config}
          id={props.id ?? "tar"}
          w={props.w}
          h={props.h}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(view.unmount);
  return view;
}

describe("RendezvousComponent", () => {
  let fixture: StreamFixture;

  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearAugments();
  });

  it("says it is waiting, not that no target is set, until vessel.target is reported", () => {
    // Nothing has arrived, so nothing about the game is claimed.
    fixture = setupStreamFixture({
      suspendFrames: true,
    });
    const { container } = renderWidget(fixture);
    expect(visibleText(container)).toContain("Waiting for target telemetry");
    expect(visibleText(container)).not.toContain("No target set in KSP");
  });

  it("renders compact-mode distance once target name + distance arrive", async () => {
    fixture = setupStreamFixture({
      suspendFrames: true,
    });
    const { container } = renderWidget(fixture);
    act(() => {
      fixture.emit("vessel.target", {
        name: "Minmus",
        kind: KIND.CelestialBody,
        relativePosition: atRange(47_000_000),
        relativeVelocity: null,
      });
    });
    await waitFor(() => expect(visibleText(container)).toContain("Minmus"));
    expect(visibleText(container)).toMatch(/\d[\d.]*\s*(k?m|Mm)/);
  });

  it("auto-switches to the docking HUD when a docking-port target with dock data drops under 100 m", async () => {
    fixture = setupStreamFixture({
      suspendFrames: true,
    });
    renderWidget(fixture);
    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: KIND.Vessel,
        relativePosition: atRange(90),
        relativeVelocity: atRange(-0.8),
      });
      // A real docking scenario: only vessel.dock gives the HUD reticle signal.
      fixture.emit("vessel.dock", {
        relativePosition: atRange(90),
        relativeVelocity: atRange(-0.8),
        distance: 90,
        forwardDot: 0.99,
      });
    });
    await waitFor(() => expect(dockingCircle()).toBeInTheDocument());
  });

  it("does NOT enter the docking HUD for a Vessel target with no vessel.dock", async () => {
    // A plain Vessel target has no dock channel, so under 100 m it stays in the approach view.
    fixture = setupStreamFixture({
      suspendFrames: true,
    });
    renderWidget(fixture);
    act(() => {
      fixture.emit("vessel.target", {
        name: "Free Flyer",
        kind: KIND.Vessel,
        relativePosition: atRange(60),
        relativeVelocity: atRange(-0.5),
      });
    });
    await waitFor(() =>
      expect(screen.getByText("Free Flyer")).toBeInTheDocument(),
    );
    expect(queryDockingCircle()).toBeNull();
    // An eligible rendezvous target lands in the approach view.
    expect(screen.getByText("APPROACH")).toBeInTheDocument();
  });

  it("never HUD-switches on CelestialBody targets", async () => {
    fixture = setupStreamFixture({
      suspendFrames: true,
    });
    renderWidget(fixture);
    act(() => {
      fixture.emit("vessel.target", {
        name: "Mun",
        kind: KIND.CelestialBody,
        relativePosition: atRange(50),
        relativeVelocity: null,
      });
    });
    await waitFor(() => expect(screen.getByText("Mun")).toBeInTheDocument());
    expect(queryDockingCircle()).toBeNull();
  });

  it("honours autoSwitch=false", async () => {
    fixture = setupStreamFixture({
      suspendFrames: true,
    });
    const { container } = renderWidget(fixture, { autoSwitch: false });
    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: KIND.Vessel,
        relativePosition: atRange(50),
        relativeVelocity: null,
      });
    });
    await waitFor(() =>
      expect(visibleText(container)).toContain("Test Station"),
    );
    expect(queryDockingCircle()).toBeNull();
  });

  it("applies hysteresis; stays in HUD until distance rises past 150 m", async () => {
    fixture = setupStreamFixture({
      suspendFrames: true,
    });
    renderWidget(fixture);
    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: KIND.Vessel,
        relativePosition: atRange(80),
        relativeVelocity: null,
      });
      // Dock data present throughout: the HUD enter/exit is distance-driven.
      fixture.emit("vessel.dock", {
        relativePosition: atRange(80),
        relativeVelocity: null,
        distance: 80,
        forwardDot: 0.99,
      });
    });
    await waitFor(() => expect(dockingCircle()).toBeInTheDocument());

    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: KIND.Vessel,
        relativePosition: atRange(130),
        relativeVelocity: null,
      });
    });
    // 130 m is between the 100 m enter and 150 m exit thresholds; with no settle signal, give the frame a chance to run.
    await waitFor(() => expect(dockingCircle()).toBeInTheDocument());

    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: KIND.Vessel,
        relativePosition: atRange(200),
        relativeVelocity: null,
      });
    });
    await waitFor(() => expect(queryDockingCircle()).toBeNull());
  });

  it("switches to approach mode for Vessel targets between 100 m and 5 km", async () => {
    fixture = setupStreamFixture({
      suspendFrames: true,
    });
    renderWidget(fixture);
    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: KIND.Vessel,
        relativePosition: atRange(1_500),
        relativeVelocity: atRange(-3.4),
      });
    });
    await waitFor(() =>
      expect(screen.getByText("APPROACH")).toBeInTheDocument(),
    );
    expect(screen.getByText("Test Station")).toBeInTheDocument();
    // The Approach level's circle is the large one, and its dot is the current one.
    await waitFor(() =>
      expect(
        screen.getByRole("group", { name: "Approach level" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Approach level" }),
    ).toHaveAttribute("aria-current", "step");
  });

  it("never enters the Approach level for CelestialBody targets even at close range", async () => {
    fixture = setupStreamFixture({
      suspendFrames: true,
    });
    renderWidget(fixture);
    act(() => {
      fixture.emit("vessel.target", {
        name: "Mun",
        kind: KIND.CelestialBody,
        relativePosition: atRange(1_500),
        relativeVelocity: null,
      });
    });
    await waitFor(() => expect(screen.getByText("Mun")).toBeInTheDocument());
    expect(screen.queryByText("APPROACH")).toBeNull();
  });

  it("steps through tracking → approach → docking-hud as a docking target closes", async () => {
    fixture = setupStreamFixture({
      suspendFrames: true,
    });
    renderWidget(fixture);
    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: KIND.Vessel,
        relativePosition: atRange(50_000),
        relativeVelocity: null,
      });
      // Dock data present from the start; the HUD opens only under 100 m.
      fixture.emit("vessel.dock", {
        relativePosition: atRange(50_000),
        relativeVelocity: null,
        distance: 50_000,
        forwardDot: 0.99,
      });
    });
    await waitFor(() => expect(screen.getByText("FAR")).toBeInTheDocument());

    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: KIND.Vessel,
        relativePosition: atRange(2_000),
        relativeVelocity: null,
      });
    });
    await waitFor(() =>
      expect(screen.getByText("APPROACH")).toBeInTheDocument(),
    );

    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: KIND.Vessel,
        relativePosition: atRange(80),
        relativeVelocity: null,
      });
    });
    await waitFor(() => expect(dockingCircle()).toBeInTheDocument());
  });
});

describe("Rendezvous: augment slots", () => {
  afterEach(() => {
    // Unmount before clearAugments(): RTL's own cleanup runs after this file's afterEach hooks.
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearAugments();
  });

  it("exposes the docking-HUD .overlay + .camera slots and passes the reticle/camera context", async () => {
    registerAugment<"rendezvous.overlay">({
      id: "test-overlay",
      augments: "rendezvous.overlay",
      component: ({ maxDeg, reticleTravelPx }) => (
        <div data-testid="ovl">
          maxDeg={maxDeg}/travel={reticleTravelPx}
        </div>
      ),
    });
    registerAugment<"rendezvous.camera">({
      id: "test-camera",
      augments: "rendezvous.camera",
      component: ({ cameraFlightId }) => (
        <div data-testid="cam">cam={String(cameraFlightId)}</div>
      ),
    });

    const fixture = setupStreamFixture({
      suspendFrames: true,
    });
    renderWidget(fixture, { cameraFlightId: 7 }, { w: 12, h: 9 });
    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: KIND.Vessel,
        relativePosition: atRange(80),
        relativeVelocity: atRange(-0.5),
      });
      // Dock data present, so the HUD opens.
      fixture.emit("vessel.dock", {
        relativePosition: atRange(80),
        relativeVelocity: atRange(-0.5),
        distance: 80,
        forwardDot: 0.99,
      });
    });

    // Both overlay slots are composed with the passed coordinate frame.
    await waitFor(() => expect(dockingCircle()).toBeInTheDocument());
    // jsdom lays nothing out, so the travel is only checked to arrive as pixels; its scale is tested with the geometry.
    expect(screen.getByTestId("ovl").textContent).toMatch(
      /^maxDeg=8\/travel=\d+(\.\d+)?$/,
    );
    expect(screen.getByTestId("cam").textContent).toBe("cam=7");
  });

  describe("after a dock clears the target", () => {
    function openDockingHud(config: Record<string, unknown>) {
      registerAugment<"rendezvous.camera">({
        id: "test-camera",
        augments: "rendezvous.camera",
        component: () => <div data-testid="cam" />,
      });
      const fixture = setupStreamFixture({ suspendFrames: true });
      renderWidget(fixture, config, { w: 12, h: 9 });
      act(() => {
        fixture.emit("vessel.target", {
          name: "Test Station",
          kind: KIND.Vessel,
          relativePosition: atRange(2),
          relativeVelocity: atRange(-0.5),
        });
        fixture.emit("vessel.dock", {
          relativePosition: atRange(2),
          relativeVelocity: atRange(-0.5),
          distance: 2,
          forwardDot: 0.99,
        });
      });
      return fixture;
    }

    it("keeps the camera mounted behind the no-target notice", async () => {
      const fixture = openDockingHud({});
      await waitFor(() =>
        expect(screen.getByTestId("cam")).toBeInTheDocument(),
      );
      const cam = screen.getByTestId("cam");

      act(() => {
        fixture.emit("vessel.target", null);
      });

      await waitFor(() =>
        expect(screen.getByText("No target set in KSP")).toBeInTheDocument(),
      );
      expect(screen.getByTestId("cam")).toBeInTheDocument();
      // The Docking circle stays up, without its reticle, so the picture is not cut off mid-dock.
      expect(queryDockingCircle()).toBeInTheDocument();
      expect(cam.isConnected).toBe(true);
    });

    it("shows no camera when the target was never in docking range", async () => {
      registerAugment<"rendezvous.camera">({
        id: "test-camera",
        augments: "rendezvous.camera",
        component: () => <div data-testid="cam" />,
      });
      const fixture = setupStreamFixture({ suspendFrames: true });
      renderWidget(fixture, {}, { w: 12, h: 9 });
      act(() => {
        fixture.emit("vessel.target", {
          name: "Far",
          kind: KIND.Vessel,
          relativePosition: atRange(5000),
          relativeVelocity: atRange(-0.5),
        });
      });
      await waitFor(() => expect(visibleText()).toContain("Far"));
      act(() => {
        fixture.emit("vessel.target", null);
      });
      await waitFor(() =>
        expect(screen.getByText("No target set in KSP")).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("cam")).toBeNull();
    });

    it("shows no camera in the HUD-only variant", async () => {
      const fixture = openDockingHud({ hudMode: "hud" });
      await waitFor(() => expect(dockingCircle()).toBeInTheDocument());
      act(() => {
        fixture.emit("vessel.target", null);
      });
      await waitFor(() =>
        expect(screen.getByText("No target set in KSP")).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("cam")).toBeNull();
    });
  });

  it("reads a captured port as docked, the last state the dock channel delivers", async () => {
    registerAugment<"rendezvous.camera">({
      id: "test-camera-captured",
      augments: "rendezvous.camera",
      component: ({ docked }) => (
        <div data-testid="cam">{docked ? "docked" : "free"}</div>
      ),
    });
    const fixture = setupStreamFixture({ suspendFrames: true });
    renderWidget(fixture, {}, { w: 12, h: 9 });
    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: KIND.Vessel,
        relativePosition: atRange(0.5),
        relativeVelocity: atRange(-0.3),
      });
      fixture.emit("vessel.dock", {
        relativePosition: atRange(0.5),
        relativeVelocity: atRange(-0.3),
        distance: 0.5,
        forwardDot: -1,
        ownPortState: 1,
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("cam").textContent).toBe("docked"),
    );
  });

  it("hands the camera the target port's ids and draws no ring, crosshair or ticks over a camera picture", async () => {
    registerAugment<"rendezvous.camera">({
      id: "test-camera-picture",
      augments: "rendezvous.camera",
      component: ({ targetPort, docked, reportPicture }) => {
        useEffect(() => {
          reportPicture({ frameWidth: 1024, frameHeight: 576, vfovDeg: 60 });
          return () => reportPicture(null);
        }, [reportPicture]);
        return (
          <div data-testid="cam">
            {targetPort
              ? `${targetPort.vesselPersistentId}/${targetPort.portPersistentId}`
              : "no port"}
            {docked ? " docked" : " free"}
          </div>
        );
      },
    });

    const fixture = setupStreamFixture({
      suspendFrames: true,
    });
    const { container } = renderWidget(fixture, {}, { w: 12, h: 9 });
    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: KIND.Vessel,
        relativePosition: atRange(80),
        relativeVelocity: atRange(-0.5),
      });
      fixture.emit("vessel.dock", {
        relativePosition: atRange(80),
        relativeVelocity: atRange(-0.5),
        distance: 80,
        forwardDot: -1,
        targetVesselPersistentId: 4000000001,
        targetPortPersistentId: 1234,
        ownPortState: 2,
      });
    });

    await waitFor(
      () =>
        expect(screen.getByTestId("cam").textContent).toBe(
          "4000000001/1234 docked",
        ),
      { timeout: 10_000 },
    );
    const ring = [...container.querySelectorAll<HTMLElement>("div")].find(
      (el) => el.style.borderRadius === "var(--radius-circle)",
    );
    expect(ring).toBeUndefined();
    const hudMarks = [...container.querySelectorAll<HTMLElement>("div")].filter(
      (el) => el.style.background.startsWith("rgba(0, 255, 136"),
    );
    expect(hudMarks).toEqual([]);
  });
});
