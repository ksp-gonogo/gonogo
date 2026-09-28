import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

/**
 * When the elements the apsis figures are solved from stop arriving, the plan
 * is withheld rather than marked: it would be a confident burn for a position
 * the craft has left. The gate does not reach the diagram's own trajectory.
 */

describe("ManeuverPlanner when its apsis inputs stop arriving", () => {
  it("withholds the plan and says it is waiting", async () => {
    const fixture = setupStreamFixture({
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
        // The control below needs a conic model, which needs a stated horizon.
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

    // Withheld out loud: a silent empty panel would look like one that never had telemetry.
    await waitFor(() =>
      expect(visibleText(container)).toContain("Awaiting orbit telemetry"),
    );
  });
});
