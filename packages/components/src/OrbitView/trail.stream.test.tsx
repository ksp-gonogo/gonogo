import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitViewComponent } from "./index";

/** The observed trail is drawn apart from the predicted path: joined into one curve they would read as equally certain. */
const CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
  "system.frame",
];

const UT = 1_000;

/**
 * A tilted, rotated, circular orbit. At zero angles the diagram's frame and the solve's frame coincide, so no assertion could tell them apart.
 * A circle makes the frame check a comparison against one radius.
 */
function orbitAt() {
  return {
    referenceBodyIndex: 1,
    sma: 850_000,
    ecc: 0,
    inc: 35,
    lan: 70,
    argPe: 40,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
    mu: 3.5316e12,
    horizon: ANALYTIC_UNBOUNDED_HORIZON,
  };
}

/** The trail's points, out of the path the diagram drew, in its own user units. */
function trailPoints(container: Element): { x: number; y: number }[] {
  const d =
    container.querySelector('[data-trajectory="trail"]')?.getAttribute("d") ??
    "";
  return d
    .split(" ")
    .filter((part) => part.length > 1)
    .map((part) => {
      const [x, y] = part.slice(1).split(",").map(Number);
      return { x, y };
    });
}

function setup() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: UT,
    suspendFrames: true,
  });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ov-trail" }}>
        <OrbitViewComponent id="ov-trail" w={9} h={18} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("system.bodies", {
      bodies: [
        { index: 1, name: "Kerbin", gravParameter: 3.5316e12, radius: 600000 },
      ],
    });
  });
  return { fixture, view };
}

describe("OrbitView: the trail behind the craft", () => {
  it("draws no trail from a single sample", async () => {
    // One observation is a position, not a path.
    const { fixture, view } = setup();
    act(() => {
      fixture.emit("vessel.orbit", orbitAt());
    });

    await waitFor(() => expect(screen.getByText("orbit plane")).toBeTruthy());
    expect(
      view.container.querySelector('[data-trajectory="trail"]'),
    ).toBeNull();
  });

  it("draws one once several observations have arrived", async () => {
    const { fixture, view } = setup();
    // Distinct instants, so the samples are distinct places on the orbit.
    for (const at of [750, 800, 850, 900, 950]) {
      act(() => {
        fixture.emit("vessel.orbit", orbitAt(), {
          validAt: at,
          deliveredAt: at,
        });
      });
    }

    await waitFor(() =>
      expect(
        view.container.querySelector('[data-trajectory="trail"]'),
      ).not.toBeNull(),
    );
  });

  it("draws the trail on the orbit the diagram drew, not beside it", async () => {
    // In the body-centred inertial frame the tilt pulls most points well inside the radius while the curve still looks like an orbit.
    const { fixture, view } = setup();
    for (const at of [750, 800, 850, 900, 950]) {
      act(() => {
        fixture.emit("vessel.orbit", orbitAt(), {
          validAt: at,
          deliveredAt: at,
        });
      });
    }

    await waitFor(() =>
      expect(
        view.container.querySelector('[data-trajectory="trail"]'),
      ).not.toBeNull(),
    );

    const points = trailPoints(view.container);
    expect(points.length).toBeGreaterThan(1);
    for (const p of points) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(850_000, -4);
    }
  });

  it("keeps the trail a separate element from the predicted arc", async () => {
    // One is a record and one is a prediction, so they are separate elements.
    const { fixture, view } = setup();
    for (const at of [750, 800, 850, 900, 950]) {
      act(() => {
        fixture.emit("vessel.orbit", orbitAt(), {
          validAt: at,
          deliveredAt: at,
        });
      });
    }

    await waitFor(() =>
      expect(
        view.container.querySelector('[data-trajectory="trail"]'),
      ).not.toBeNull(),
    );
    const trail = view.container.querySelector('[data-trajectory="trail"]');
    // An analytic horizon draws the forward path as an ellipse; either way it is a different element from the trail.
    const forward = view.container.querySelector("ellipse");
    expect(forward).not.toBeNull();
    expect(trail).not.toBe(forward);
    // And drawn more faintly, so the record does not read as the prediction.
    expect(
      Number.parseFloat(trail?.getAttribute("stroke-opacity") ?? "1"),
    ).toBeLessThan(1);
  });
});
