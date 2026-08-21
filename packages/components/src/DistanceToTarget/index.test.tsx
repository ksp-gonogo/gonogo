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
import { DistanceToTargetComponent } from "./index";

/**
 * Mode-transition + docking-gate behavior, exercised through the stream
 * (`TelemetryProvider`/`TelemetryClient`/`TimelineStore`) pipeline via
 * `setupStreamFixture`: the widget's legacy `MockDataSource` fallback path
 * is gone (`vessel.target`/`vessel.dock` are its only reads). The widget
 * derives distance / closing rate / docking angles client-side from
 * `vessel.target`/`vessel.dock`'s Vec3 fields, so these tests feed those Vec3
 * reads directly, the widget's `tarDistance` (which drives every mode
 * switch) is `|vessel.target.relativePosition|`. The live TCA readout, which
 * needs the SDK view-UT (`useViewUt`, provider-only), is covered in
 * `stream.test.tsx`.
 *
 * Every assertion that follows a `fixture.emit` is wrapped in `waitFor`,
 * the streamed value only lands via `TimelineStore`'s `subscribeFrame`
 * (a `requestAnimationFrame`-scheduled commit, unlike the old synchronous
 * `MockDataSource` emit), so a bare post-`act()` read races the update.
 */

/** Vec3 purely along z, so `|relativePosition|` (the mode driver) === `d`. */
function atRange(d: number) {
  return { x: 0, y: 0, z: d };
}

/** `tar.type` legacy string -> the `vessel.target.kind` ordinal it now maps to. */
const KIND: Record<string, number> = { Vessel: 0, CelestialBody: 1 };

// Rendered trees, tracked so afterEach can unmount them BEFORE clearAugments()
// notifies the augment-slot subscribers: clearAugments() firing on a
// still-mounted widget's AugmentSlot is a state update outside act() (CLAUDE.md
// -> Testing Philosophy). RTL auto-cleanup runs after this file's afterEach
// hooks, too late to unmount first.
const renderedTrees: Array<() => void> = [];

function renderWidget(
  fixture: StreamFixture,
  config: Record<string, unknown> = {},
  props: { id?: string; w?: number; h?: number } = {},
) {
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: props.id ?? "tar" }}>
        <DistanceToTargetComponent
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

describe("DistanceToTargetComponent", () => {
  let fixture: StreamFixture;

  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearAugments();
  });

  it("says it is waiting, not that no target is set, until vessel.target is reported", () => {
    // This assertion used to expect "No target set in KSP" here, which was the
    // widget asserting a fact about game state from the absence of a frame. The
    // two are now separate branches of the reading: nothing has arrived, so
    // nothing about the game is being claimed. See `reading.test.tsx`.
    fixture = setupStreamFixture({ carriedChannels: ["vessel.target"] });
    const { container } = renderWidget(fixture);
    expect(visibleText(container)).toContain("Waiting for target telemetry");
    expect(visibleText(container)).not.toContain("No target set in KSP");
  });

  it("renders compact-mode distance once target name + distance arrive", async () => {
    fixture = setupStreamFixture({ carriedChannels: ["vessel.target"] });
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
    });
    renderWidget(fixture);
    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: KIND.Vessel,
        relativePosition: atRange(90),
        relativeVelocity: atRange(-0.8),
      });
      // A real docking scenario: the mod carries vessel.dock (relative
      // position of the two ports). Only then does the HUD reticle have signal.
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
    // T2: a plain Vessel target has no dock channel, promoting it to the HUD
    // on distance alone rendered a dead-centre reticle with every row showing
    // the null-display placeholder.
    // Under 100 m with no dock it must stay in the approach view instead.
    fixture = setupStreamFixture({
      carriedChannels: ["vessel.target", "vessel.dock"],
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
    // It's an eligible rendezvous target, so it lands in the approach view.
    expect(screen.getByText("APPROACH")).toBeInTheDocument();
  });

  it("never HUD-switches on CelestialBody targets", async () => {
    fixture = setupStreamFixture({ carriedChannels: ["vessel.target"] });
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
    fixture = setupStreamFixture({ carriedChannels: ["vessel.target"] });
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
    // Still in HUD: 130 m is above the 100 m enter threshold but below the
    // 150 m exit threshold. There's no distinct settle signal to wait on
    // here (the DOM shouldn't change), so give the frame a chance to run
    // before asserting nothing has flipped.
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
    fixture = setupStreamFixture({ carriedChannels: ["vessel.target"] });
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
    // Closing → negative radial rate → minus-sign + magnitude
    expect(visibleText()).toMatch(/−3\.4 m\/s/);
  });

  it("never enters approach mode for CelestialBody targets even at close range", async () => {
    fixture = setupStreamFixture({ carriedChannels: ["vessel.target"] });
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
    });
    renderWidget(fixture);
    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: KIND.Vessel,
        relativePosition: atRange(50_000),
        relativeVelocity: null,
      });
      // Dock data present from the start; the HUD still only opens once the
      // distance drops under 100 m (tracking → approach → docking-hud).
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

describe("DistanceToTarget: augment slots (spec §4)", () => {
  afterEach(() => {
    // clearAugments() must come after unmount, else a still-mounted
    // AugmentSlot re-renders outside act() when the registry notifies
    // (CLAUDE.md → Testing Philosophy, act() warning pattern). RTL's
    // auto-cleanup afterEach runs AFTER this file's own afterEach hooks
    // (outer/import-time-registered hooks run after inner describe-scoped
    // ones), so it can't be relied on to unmount first, the renderedTrees
    // tracking above is what actually guarantees the ordering.
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearAugments();
  });

  it("exposes the docking-HUD .overlay + .camera slots and passes the reticle/camera context", async () => {
    registerAugment<"distance-to-target.overlay">({
      id: "test-overlay",
      augments: "distance-to-target.overlay",
      component: ({ maxDeg, reticleTravelPct }) => (
        <div data-testid="ovl">
          maxDeg={maxDeg}/travel={reticleTravelPct}
        </div>
      ),
    });
    registerAugment<"distance-to-target.camera">({
      id: "test-camera",
      augments: "distance-to-target.camera",
      component: ({ cameraFlightId }) => (
        <div data-testid="cam">cam={String(cameraFlightId)}</div>
      ),
    });

    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.target", "vessel.dock"],
    });
    renderWidget(fixture, { cameraFlightId: 7 }, { w: 12, h: 9 });
    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: KIND.Vessel,
        relativePosition: atRange(80),
        relativeVelocity: atRange(-0.5),
      });
      // Dock data present → a real docking scenario, so the HUD opens.
      fixture.emit("vessel.dock", {
        relativePosition: atRange(80),
        relativeVelocity: atRange(-0.5),
        distance: 80,
        forwardDot: 0.99,
      });
    });

    // HUD is up → both overlay slots composed with the passed coordinate frame.
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /Docking HUD for Test Station/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("ovl").textContent).toBe("maxDeg=8/travel=40");
    expect(screen.getByTestId("cam").textContent).toBe("cam=7");
  });
});
