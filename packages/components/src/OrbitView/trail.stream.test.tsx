import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitViewComponent } from "./index";

/**
 * The trail behind the craft: what was observed, drawn apart from what is
 * predicted.
 *
 * The two are different kinds of claim, so they are different elements with
 * different weights. Joined into one curve through the craft they would read as
 * equally certain, and the half that is a guess is the half an operator acts on.
 */
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
 * A TILTED, rotated orbit, which is the whole reason these numbers are not
 * zeroes.
 *
 * <p>At `inc = lan = argPe = 0` the frame the diagram draws in and the frame a
 * solve hands back are the same frame, so a trail expressed in either one comes
 * out identical and no assertion here can tell them apart. Round, deliberately:
 * a circle's points are all one distance from the centre whatever the instant,
 * which is what makes the frame check below a comparison against a number rather
 * than against another implementation of the same solve.</p>
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
    // One observation is a position, not a path. Drawing a line through it
    // would be drawing a direction of travel nothing has evidenced.
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
    // The frame check. The diagram is drawn in the orbit's own plane, and a
    // trail handed back in the body-centred inertial frame is the right shape at
    // the right size, rotated away from the drawn orbit by that orbit's three
    // angles and flattened out of its plane by the tilt. On a round orbit every
    // point of the real path is exactly one radius from the centre; in the wrong
    // frame the tilt pulls most of them a hundred kilometres inside it, and the
    // curve still looks like an orbit.
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
    // The whole point: one is a record and one is a prediction. A single path
    // element carrying both would say they are the same kind of thing.
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
    // The forward path here is the conic the elements describe, drawn as an
    // ellipse rather than as supplied points: an analytic horizon means no
    // provider handed over an arc. Either way it is a DIFFERENT element from
    // the trail, which is the claim.
    const forward = view.container.querySelector("ellipse");
    expect(forward).not.toBeNull();
    expect(trail).not.toBe(forward);
    // And drawn more faintly, so the record does not read as the prediction.
    expect(
      Number.parseFloat(trail?.getAttribute("stroke-opacity") ?? "1"),
    ).toBeLessThan(1);
  });
});
