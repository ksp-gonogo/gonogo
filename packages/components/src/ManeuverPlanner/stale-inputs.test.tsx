import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

/**
 * What the planner does when the elements its apsis figures are solved from
 * stop arriving.
 *
 * `ApR`, `PeR`, `timeToAp` and `timeToPe` are derived at view time off
 * `vessel.orbit`, and they are absent together whenever the conic that
 * authorises deriving them has withdrawn: there is no model to carry stale
 * elements forward, so there is nothing for `computePlan` to take.
 *
 * The plan is WITHHELD rather than marked: a plan built on inputs that stopped
 * arriving is wrong rather than stale, and it does not look wrong. It renders
 * as a confident burn for a position the craft has left.
 *
 * The gating governs this ADDITIONAL reasoning only and must not reach the
 * diagram's own reckoning of basic motion, which it does not: the diagram is
 * `useOrbitTrajectory(orbit)`, fed from the `vessel.orbit` reading rather than
 * from any of these four.
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
];

describe("ManeuverPlanner when its apsis inputs stop arriving", () => {
  it("withholds the plan and says it is waiting", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 1_000_000,
      suspendFrames: true,
    });
    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mnv-stale" }}>
          <ManeuverPlannerComponent id="mnv-stale" config={{}} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.orbit", {
        referenceBodyIndex: 1,
        sma: 700000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 1_000_000,
        mu: 3.5316e12,
        // The reach and shape a live sample states, and the roster beside it:
        // the two declared inputs of the conic the apsis figures are solved
        // through. The control below is that the planner is NOT waiting, which
        // needs a model to exist at all.
        horizon: ANALYTIC_UNBOUNDED_HORIZON,
      });
      fixture.emit("system.bodies", {
        bodies: [{ index: 1, name: "Kerbin", radius: 600000 }],
      });
    });

    // The control: with the inputs current, the planner is NOT waiting.
    await waitFor(() =>
      expect(visibleText(container)).not.toContain("Awaiting orbit telemetry"),
    );

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    /*
     * Withheld, and it SAYS so rather than going quiet: a planner that silently
     * shows its last plan is the failure this gate exists to stop, and an empty
     * panel would be indistinguishable from one that never had telemetry.
     */
    await waitFor(() =>
      expect(visibleText(container)).toContain("Awaiting orbit telemetry"),
    );
  });
});
