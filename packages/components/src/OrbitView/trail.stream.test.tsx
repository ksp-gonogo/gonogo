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

function orbitAt() {
  return {
    referenceBodyIndex: 1,
    sma: 850_000,
    ecc: 0.01,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
    mu: 3.5316e12,
    horizon: ANALYTIC_UNBOUNDED_HORIZON,
  };
}

function setup() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: UT,
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
