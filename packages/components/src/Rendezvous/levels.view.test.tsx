import {
  clearActionHandlers,
  clearAugments,
  DashboardItemContext,
  dispatchAction,
  registerAugment,
} from "@ksp-gonogo/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installRendezvousBox } from "../test/rendezvousBox";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { RendezvousComponent } from "./index";

/**
 * The levels as an operator meets them: the dots, a level stepped to by hand,
 * the keys bound to stepping, the camera's circular frame, the scale bar and
 * the body target's Encounter. The box is measured and motion reduced, so a
 * level change lands at once.
 */

const MU = 3.5316e12;
const A = 700_000;
const HOR = { kind: 1, trajectoryKind: 1 };
const orbit = (m0: number, over: Record<string, unknown> = {}) => ({
  referenceBodyIndex: 1,
  sma: A,
  ecc: 0.0001,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: m0,
  epoch: 0,
  mu: MU,
  timeToAp: null,
  timeToPe: null,
  encounter: null,
  patches: [],
  horizon: HOR,
  ...over,
});
const BODIES = {
  bodies: [
    {
      name: "Kerbin",
      index: 1,
      parentIndex: 0,
      radius: 600_000,
      sphereOfInfluence: 84_159_286,
      orbit: null,
      horizon: HOR,
    },
    {
      name: "Mun",
      index: 2,
      parentIndex: 1,
      radius: 200_000,
      sphereOfInfluence: 2_429_559,
      orbit: null,
      horizon: HOR,
    },
  ],
};
const INSTANCE = "levels";
let restoreBox: (() => void) | undefined;
const trees: Array<() => void> = [];

beforeEach(() => {
  restoreBox = installRendezvousBox();
});

afterEach(() => {
  restoreBox?.();
  for (const unmount of trees) unmount();
  trees.length = 0;
  clearAugments();
  clearActionHandlers();
});

function mount(config: Record<string, unknown> = {}) {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: INSTANCE }}>
        <RendezvousComponent id={INSTANCE} config={config} w={6} h={9} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  trees.push(view.unmount);
  return { fixture, ...view };
}

/** A craft target `range` metres ahead on your own orbit. */
function emitCraft(
  fixture: ReturnType<typeof setupStreamFixture>,
  range: number,
  dock = false,
) {
  act(() => {
    fixture.emit("trackingStation.bodies", BODIES);
    fixture.emit("vessel.orbit", orbit(1));
    fixture.emit("vessel.target", {
      name: "Test Station",
      kind: 0,
      vesselId: "t",
      bodyIndex: null,
      relativePosition: { x: 0, y: 0, z: range },
      relativeVelocity: { x: 0, y: 0, z: -0.5 },
      orbit: orbit(1 + range / A),
      closestApproach: { time: 100, distance: 12 },
    });
    if (dock) {
      fixture.emit("vessel.dock", {
        relativePosition: { x: 0.1, y: 0, z: range },
        relativeVelocity: { x: 0, y: 0, z: -0.5 },
        distance: range,
        forwardDot: 0.9999,
      });
    }
  });
}

const circle = (level: string) =>
  screen.queryByRole("group", { name: `${level} level` });
const dot = (level: string) =>
  screen.getByRole("button", { name: `${level} level` });

describe("the dots", () => {
  it("are real buttons, one per level, and mark the level the large circle is at", async () => {
    const { fixture } = mount();
    emitCraft(fixture, 3_000);
    await waitFor(() => expect(circle("Approach")).not.toBeNull());
    expect(dot("Far").tagName).toBe("BUTTON");
    expect(dot("Approach")).toHaveAttribute("aria-current", "step");
    expect(dot("Far")).not.toHaveAttribute("aria-current");
    expect(dot("Docking")).not.toHaveAttribute("aria-current");
  });

  it("step the view to the level pressed, and the level just left shows in the small circle", async () => {
    const { fixture } = mount();
    emitCraft(fixture, 3_000);
    await waitFor(() => expect(circle("Approach")).not.toBeNull());
    fireEvent.click(dot("Far"));
    await waitFor(() =>
      expect(dot("Far")).toHaveAttribute("aria-current", "step"),
    );
    expect(circle("Far")).not.toBeNull();
    // Far is the first level, so nothing was left before it: there is no small circle.
    expect(document.querySelectorAll("[data-lens]")).toHaveLength(1);
  });

  it("hold a hand-picked level until the view's own choice moves on, then lapse", async () => {
    const { fixture } = mount();
    emitCraft(fixture, 3_000);
    await waitFor(() => expect(circle("Approach")).not.toBeNull());
    fireEvent.click(dot("Far"));
    await waitFor(() =>
      expect(dot("Far")).toHaveAttribute("aria-current", "step"),
    );
    // Still approach by range: the hand-picked level holds.
    emitCraft(fixture, 2_000);
    await act(async () => {});
    expect(dot("Far")).toHaveAttribute("aria-current", "step");
    // Out past the approach scale the view's own choice is Far, and back in it is Approach again.
    emitCraft(fixture, 20_000);
    await waitFor(() =>
      expect(dot("Far")).toHaveAttribute("aria-current", "step"),
    );
    emitCraft(fixture, 2_000);
    await waitFor(() =>
      expect(dot("Approach")).toHaveAttribute("aria-current", "step"),
    );
  });

  it("are left out of a tile too small for them, and the view follows its own choice", async () => {
    restoreBox?.();
    restoreBox = installRendezvousBox({ w: 226, h: 277 });
    const { fixture } = mount();
    emitCraft(fixture, 3_000);
    await waitFor(() => expect(circle("Approach")).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Far level" })).toBeNull();
  });
});

describe("the level keys", () => {
  it("step one level in and one out from the level the view is at, and stop at the ends", async () => {
    const { fixture } = mount();
    emitCraft(fixture, 3_000);
    await waitFor(() => expect(circle("Approach")).not.toBeNull());
    const press = (id: "level-in" | "level-out") =>
      act(() => {
        dispatchAction(INSTANCE, id, { kind: "button", value: true });
      });
    press("level-out");
    await waitFor(() =>
      expect(dot("Far")).toHaveAttribute("aria-current", "step"),
    );
    press("level-out");
    expect(dot("Far")).toHaveAttribute("aria-current", "step");
    press("level-in");
    await waitFor(() =>
      expect(dot("Approach")).toHaveAttribute("aria-current", "step"),
    );
  });

  it("do nothing on release", async () => {
    const { fixture } = mount();
    emitCraft(fixture, 3_000);
    await waitFor(() => expect(circle("Approach")).not.toBeNull());
    act(() => {
      dispatchAction(INSTANCE, "level-out", { kind: "button", value: false });
    });
    expect(dot("Approach")).toHaveAttribute("aria-current", "step");
  });
});

describe("the scale bar", () => {
  it("is drawn at the Approach level and not at Docking, where a picture has no single scale", async () => {
    const { fixture } = mount();
    emitCraft(fixture, 3_000);
    await waitFor(() => expect(circle("Approach")).not.toBeNull());
    expect(document.querySelector("[data-scale-bar]")).not.toBeNull();
    emitCraft(fixture, 60, true);
    await waitFor(() => expect(circle("Docking")).not.toBeNull());
    expect(document.querySelector("[data-scale-bar]")).toBeNull();
  });
});

describe("the Docking circle", () => {
  it("is a circular frame and tells the camera slot the circle it is cut to", async () => {
    let seen:
      | { cx: number; cy: number; radius: number; borderWidth: number }
      | undefined;
    registerAugment<"rendezvous.camera">({
      id: "probe-camera",
      augments: "rendezvous.camera",
      component: ({ pictureCircle }) => {
        seen = pictureCircle;
        return <div data-testid="cam" />;
      },
    });
    const { fixture } = mount();
    emitCraft(fixture, 60, true);
    await waitFor(() => expect(circle("Docking")).not.toBeNull());
    expect(circle("Docking")).toHaveAttribute("data-shape", "circle");
    await waitFor(() => expect(seen).toBeDefined());
    expect(seen?.cx).toBe(seen?.cy);
    expect(seen?.radius).toBe(seen?.cx);
    expect(seen?.borderWidth).toBe(1);
  });
});

describe("the border cue", () => {
  /** A camera slot that reports a picture with a 60 degree vertical field, once. */
  function reportingCamera(
    picture: {
      frameWidth: number;
      frameHeight: number;
      vfovDeg: number;
    } | null,
  ) {
    registerAugment<"rendezvous.camera">({
      id: "reporting-camera",
      augments: "rendezvous.camera",
      component: ({ reportPicture }) => {
        useEffect(() => {
          reportPicture?.(picture);
        }, [reportPicture]);
        return <div data-testid="cam" />;
      },
    });
  }
  /** The port `x` metres across and `z` ahead, so its angle is atan(x / z). */
  function emitPortAt(
    fixture: ReturnType<typeof setupStreamFixture>,
    x: number,
    y: number,
    z: number,
  ) {
    act(() => {
      fixture.emit("trackingStation.bodies", BODIES);
      fixture.emit("vessel.orbit", orbit(1));
      fixture.emit("vessel.target", {
        name: "Port",
        kind: 0,
        vesselId: "t",
        bodyIndex: null,
        relativePosition: { x: 0, y: 0, z },
        relativeVelocity: { x: 0, y: 0, z: -0.5 },
        orbit: orbit(1 + z / A),
      });
      fixture.emit("vessel.dock", {
        relativePosition: { x, y, z },
        relativeVelocity: { x: 0, y: 0, z: -0.5 },
        distance: Math.hypot(x, y, z),
        forwardDot: 0.9999,
      });
    });
  }
  const PICTURE = { frameWidth: 320, frameHeight: 180, vfovDeg: 60 };

  it("lights an arc of the border toward a port that is past the edge of the picture", async () => {
    reportingCamera(PICTURE);
    const { fixture } = mount();
    // 45 degrees to the right on a 30 degree half-field: off the picture, to the right.
    emitPortAt(fixture, 60, 0, 60);
    await waitFor(() => expect(circle("Docking")).not.toBeNull());
    await waitFor(() =>
      expect(document.querySelector("[data-edge-cue]")).not.toBeNull(),
    );
    expect(
      document.querySelector("[data-edge-cue]")?.getAttribute("fill"),
    ).toBe("var(--color-warn-mark)");
  });

  it("draws no arc while the port is in the picture", async () => {
    reportingCamera(PICTURE);
    const { fixture } = mount();
    emitPortAt(fixture, 5, 0, 60);
    await waitFor(() => expect(circle("Docking")).not.toBeNull());
    await act(async () => {});
    expect(document.querySelector("[data-edge-cue]")).toBeNull();
  });

  it("lights the arc on the drawn picture's rim while no camera has reported a picture", async () => {
    registerAugment<"rendezvous.camera">({
      id: "silent-camera",
      augments: "rendezvous.camera",
      component: () => <div data-testid="cam" />,
    });
    const { fixture } = mount();
    emitPortAt(fixture, 60, 0, 60);
    await waitFor(() => expect(circle("Docking")).not.toBeNull());
    await act(async () => {});
    expect(document.querySelector("[data-edge-cue]")).not.toBeNull();
  });

  it("lights the arc on the drawn picture's rim with no camera at all", async () => {
    const { fixture } = mount({ hudMode: "hud" });
    emitPortAt(fixture, 60, 0, 60);
    await waitFor(() => expect(circle("Docking")).not.toBeNull());
    await act(async () => {});
    expect(document.querySelector("[data-edge-cue]")).not.toBeNull();
  });

  it("draws no arc while the port is inside the drawn picture", async () => {
    const { fixture } = mount({ hudMode: "hud" });
    emitPortAt(fixture, 2, 0, 60);
    await waitFor(() => expect(circle("Docking")).not.toBeNull());
    await act(async () => {});
    expect(document.querySelector("[data-edge-cue]")).toBeNull();
  });
});

describe("the figures and the docked state", () => {
  const text = () => visibleText();
  function emitPort(
    fixture: ReturnType<typeof setupStreamFixture>,
    extra: Record<string, unknown> = {},
    kind = 0,
    withDock = true,
  ) {
    act(() => {
      fixture.emit("trackingStation.bodies", BODIES);
      fixture.emit("vessel.orbit", orbit(1));
      fixture.emit("vessel.target", {
        name: "Port",
        kind,
        vesselId: "t",
        bodyIndex: null,
        relativePosition: { x: 0, y: 0, z: 60 },
        relativeVelocity: { x: 0, y: 0, z: -0.5 },
        orbit: orbit(1 + 60 / A),
      });
      if (withDock) {
        fixture.emit("vessel.dock", {
          relativePosition: { x: 0.12, y: -0.07, z: 60 },
          relativeVelocity: { x: 0, y: 0, z: -0.5 },
          distance: 60,
          forwardDot: -1,
          ...extra,
        });
      }
    });
  }

  it("reads the closing rate positive while the ports approach", async () => {
    const { fixture } = mount();
    emitPort(fixture);
    await waitFor(() => expect(circle("Docking")).not.toBeNull());
    expect(text()).toContain("0.50 m/s");
    expect(text()).not.toContain("-0.50");
  });

  it("gives the lateral offset as one figure in metres", async () => {
    const { fixture } = mount();
    emitPort(fixture);
    await waitFor(() => expect(circle("Docking")).not.toBeNull());
    expect(text()).toContain("0.12 / -0.07 m");
  });

  it("says there is no docking data for a port targeted inside docking range with no docking channel", async () => {
    const { fixture } = mount();
    emitPort(fixture, {}, 4, false);
    await waitFor(() => expect(text()).toContain("No docking data"));
    expect(circle("Docking")).toBeNull();
  });

  it("reads Docked from the ports' states, and keeps reading it once the target is cleared", async () => {
    const { fixture } = mount();
    emitPort(fixture);
    await waitFor(() => expect(circle("Docking")).not.toBeNull());
    expect(text()).not.toContain("Docked");
    act(() => {
      fixture.emit("vessel.dock", {
        relativePosition: { x: 0, y: 0, z: 0 },
        relativeVelocity: { x: 0, y: 0, z: 0 },
        distance: 0,
        forwardDot: -1,
        ownPortState: 3,
        targetPortState: 3,
      });
    });
    await waitFor(() => expect(text()).toContain("Docked"));
    act(() => {
      fixture.emit("vessel.target", null);
    });
    await waitFor(() => expect(text()).toContain("Docked"));
    expect(text()).not.toContain("No target set in KSP");
    expect(circle("Docking")).not.toBeNull();
  });
});

describe("a body target", () => {
  it("goes Far, then Encounter when the path enters its sphere of influence, and never to Docking", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("trackingStation.bodies", BODIES);
      fixture.emit("vessel.orbit", orbit(0.5));
      fixture.emit("vessel.target", {
        name: "Mun",
        kind: 1,
        vesselId: null,
        bodyIndex: 2,
        relativePosition: { x: 0, y: 0, z: 9_000_000 },
        relativeVelocity: { x: 0, y: 0, z: -400 },
        orbit: orbit(2, { sma: 12_000_000 }),
        closestApproach: null,
      });
    });
    await waitFor(() => expect(circle("Far")).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Docking level" })).toBeNull();
    act(() => {
      fixture.emit(
        "vessel.orbit",
        orbit(0.5, {
          patches: [
            {
              sma: -190_000,
              ecc: 2.37,
              inc: 0,
              lan: 0,
              argPe: 0,
              meanAnomalyAtEpoch: -1.5,
              epoch: 0,
              peA: 60_000,
              semiLatusRectum: 190_000 * (2.37 ** 2 - 1),
              mu: 6.5138398e10,
              referenceBodyIndex: 2,
            },
          ],
        }),
      );
    });
    await waitFor(() => expect(circle("Encounter")).not.toBeNull());
    expect(dot("Encounter")).toHaveAttribute("aria-current", "step");
  });
});

describe("a target the view cannot state as current", () => {
  it("draws no geometry for a held reading, keeping the range, so nothing held is passed off as now", async () => {
    const { fixture } = mount();
    emitCraft(fixture, 3_000);
    await waitFor(() => expect(circle("Approach")).not.toBeNull());
    expect(
      document.querySelector("[data-lens] svg[role='img']"),
    ).not.toBeNull();
    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
    await waitFor(() =>
      expect(document.querySelector("[data-held]")).not.toBeNull(),
    );
    expect(document.querySelector("[data-lens] svg[role='img']")).toBeNull();
  });
});

describe("accessibility", () => {
  it("has no violations at the Approach level", async () => {
    const { fixture, container } = mount();
    emitCraft(fixture, 3_000);
    await waitFor(() => expect(circle("Approach")).not.toBeNull());
    await expectNoA11yViolations(container);
  });

  it("has no violations at the Docking level", async () => {
    const { fixture, container } = mount();
    emitCraft(fixture, 60, true);
    await waitFor(() => expect(circle("Docking")).not.toBeNull());
    await expectNoA11yViolations(container);
  });
});
