import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

/**
 * What the planner does when the channel its apsis inputs ride stops arriving.
 *
 * `ApR`, `PeR`, `timeToAp` and `timeToPe` come off derived `vessel.state`, which
 * carries no `Reading`, so nothing here could tell a current figure from one
 * that had stopped arriving and `computePlan` took them either way. Ticket 346.
 *
 * The ruling (operator, 2026-09-17) is that the plan is WITHHELD: a plan built
 * on inputs that stopped arriving is wrong rather than stale, and it does not
 * look wrong: it renders as a confident burn for a position the craft has
 * left. The boundary attached to it is that gating may govern this ADDITIONAL
 * reasoning and must not reach the diagram's own reckoning of basic motion,
 * which it does not: the diagram is `useOrbitTrajectory(orbit)`, fed from the
 * `vessel.orbit` reading rather than from any of these four.
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
