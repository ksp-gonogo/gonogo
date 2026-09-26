import {
  clearAugments,
  DashboardItemContext,
  registerAugment,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { TargetingComponent } from "./index";

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

function renderWidget(
  fixture: StreamFixture,
  config: Record<string, unknown> = {},
  props: { id?: string; w?: number; h?: number } = {},
) {
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: props.id ?? "tar" }}>
        <TargetingComponent
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

describe("TargetingComponent", () => {
  let fixture: StreamFixture;

  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearAugments();
  });

  it("says it is waiting, not that no target is set, until vessel.target is reported", () => {
    // Nothing has arrived, so nothing about the game is claimed.
    fixture = setupStreamFixture({
      carriedChannels: ["vessel.target"],
      suspendFrames: true,
    });
    const { container } = renderWidget(fixture);
    expect(visibleText(container)).toContain("Waiting for target telemetry");
    expect(visibleText(container)).not.toContain("No target set in KSP");
  });

  it("renders compact-mode distance once target name + distance arrive", async () => {
    fixture = setupStreamFixture({
      carriedChannels: ["vessel.target"],
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
      carriedChannels: ["vessel.target", "vessel.dock"],
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
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /Docking HUD for Test Station/ }),
      ).toBeInTheDocument(),
    );
  });

  it("does NOT enter the docking HUD for a Vessel target with no vessel.dock (T2)", async () => {
    // A plain Vessel target has no dock channel, so under 100 m it stays in the approach view.
    fixture = setupStreamFixture({
      carriedChannels: ["vessel.target", "vessel.dock"],
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
    expect(screen.queryByRole("region", { name: /Docking HUD/ })).toBeNull();
    // An eligible rendezvous target lands in the approach view.
    expect(screen.getByText("APPROACH")).toBeInTheDocument();
  });

  it("never HUD-switches on CelestialBody targets", async () => {
    fixture = setupStreamFixture({
      carriedChannels: ["vessel.target"],
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
    expect(screen.queryByRole("region", { name: /Docking HUD/ })).toBeNull();
  });

  it("honours autoSwitch=false", async () => {
    fixture = setupStreamFixture({
      carriedChannels: ["vessel.target"],
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
    expect(screen.queryByRole("region", { name: /Docking HUD/ })).toBeNull();
  });

  it("applies hysteresis; stays in HUD until distance rises past 150 m", async () => {
    fixture = setupStreamFixture({
      carriedChannels: ["vessel.target", "vessel.dock"],
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
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /Docking HUD/ }),
      ).toBeInTheDocument(),
    );

    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: KIND.Vessel,
        relativePosition: atRange(130),
        relativeVelocity: null,
      });
    });
    // 130 m is between the 100 m enter and 150 m exit thresholds; with no settle signal, give the frame a chance to run.
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /Docking HUD/ }),
      ).toBeInTheDocument(),
    );

    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: KIND.Vessel,
        relativePosition: atRange(200),
        relativeVelocity: null,
      });
    });
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: /Docking HUD/ })).toBeNull(),
    );
  });

  it("switches to approach mode for Vessel targets between 100 m and 5 km", async () => {
    fixture = setupStreamFixture({
      carriedChannels: ["vessel.target"],
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
    expect(screen.getByText("Closing rate")).toBeInTheDocument();
    // Closing: a negative radial rate renders with a minus sign.
    expect(visibleText()).toMatch(/−3\.4 m\/s/);
  });

  it("never enters approach mode for CelestialBody targets even at close range", async () => {
    fixture = setupStreamFixture({
      carriedChannels: ["vessel.target"],
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
      carriedChannels: ["vessel.target", "vessel.dock"],
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
    await waitFor(() => expect(screen.getByText("TARGET")).toBeInTheDocument());

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
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /Docking HUD/ }),
      ).toBeInTheDocument(),
    );
  });
});

describe("Targeting: augment slots (spec §4)", () => {
  afterEach(() => {
    // Unmount before clearAugments(): RTL's own cleanup runs after this file's afterEach hooks.
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearAugments();
  });

  it("exposes the docking-HUD .overlay + .camera slots and passes the reticle/camera context", async () => {
    registerAugment<"targeting.overlay">({
      id: "test-overlay",
      augments: "targeting.overlay",
      component: ({ maxDeg, reticleTravelPct }) => (
        <div data-testid="ovl">
          maxDeg={maxDeg}/travel={reticleTravelPct}
        </div>
      ),
    });
    registerAugment<"targeting.camera">({
      id: "test-camera",
      augments: "targeting.camera",
      component: ({ cameraFlightId }) => (
        <div data-testid="cam">cam={String(cameraFlightId)}</div>
      ),
    });

    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.target", "vessel.dock"],
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
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /Docking HUD for Test Station/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("ovl").textContent).toBe("maxDeg=8/travel=40");
    expect(screen.getByTestId("cam").textContent).toBe("cam=7");
  });
});
