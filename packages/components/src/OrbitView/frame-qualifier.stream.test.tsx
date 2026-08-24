import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitViewComponent } from "./index";

/**
 * The apsis markers, against the operator's own view frame.
 *
 * <p>Found on a render, not by a test: the pulsating-frame render of this
 * widget was pixel-identical to the inertial one, with Ap and Pe dots and
 * labels still drawn in a frame where CurrentOrbit says apsides do not exist.
 * Two panels on one dashboard disagreeing about whether a point is there.</p>
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

function setup() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
  });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ov-frame" }}>
        <OrbitViewComponent id="ov-frame" w={9} h={18} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: 1,
      sma: 850000,
      ecc: 0.01,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 10,
      horizon: ANALYTIC_UNBOUNDED_HORIZON,
      mu: 3.5316e12,
    });
    fixture.emit("system.bodies", {
      bodies: [
        { index: 1, name: "Kerbin", gravParameter: 3.5316e12, radius: 600000 },
      ],
    });
  });
  return fixture;
}

describe("OrbitView: the apsis markers and the view frame", () => {
  it("draws the Ap and Pe labels in a frame that has apsides", async () => {
    // The contrast case, and it is what gives the next test meaning: without
    // it, an assertion that the labels are absent could pass on a widget that
    // never drew them.
    const fixture = setup();
    act(() => {
      fixture.emit("system.frame", { kind: 1, centreBody: "Kerbin" });
    });

    await waitFor(() => expect(screen.getByText("Ap")).toBeTruthy());
    expect(screen.getByText("Pe")).toBeTruthy();
  });

  it("draws neither in a frame defined by a pair of bodies", async () => {
    // A dot labelled Ap on a point that does not exist, beside a panel saying
    // it does not exist.
    const fixture = setup();
    act(() => {
      fixture.emit("system.frame", {
        kind: 4,
        primaryBody: "Kerbol",
        secondaryBody: "Kerbin",
      });
    });

    // Wait for the diagram to have RENDERED before asserting the labels are
    // absent. `waitFor` around a negative assertion succeeds on its first tick,
    // which here was before the diagram existed at all: the assertion passed
    // with the frame gate deliberately disabled, and would have passed on a
    // widget that drew nothing.
    await waitFor(() =>
      expect(screen.getByText(/Drawn in the orbit's own plane/)).toBeTruthy(),
    );
    expect(screen.queryByText("Ap")).not.toBeInTheDocument();
    expect(screen.queryByText("Pe")).not.toBeInTheDocument();
  });
});
