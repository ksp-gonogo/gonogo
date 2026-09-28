import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

/**
 * Held elements no model answers for: the plan is withheld, and the widget
 * writes no caption about when its inputs were read. Time reaches the screen
 * only through Unit.
 */

describe("ManeuverPlanner planning from held, unmodelled elements", () => {
  it("withholds the plan with no last-known-orbit caption", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 1_000_000,
      suspendFrames: true,
    });
    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mnv-held" }}>
          <ManeuverPlannerComponent id="mnv-held" config={{}} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      // No stated horizon, so no model answers for the orbit once it is held.
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
      fixture.emit("system.bodies", {
        bodies: [{ index: 1, name: "Kerbin", radius: 600000 }],
      });
    });
    await waitFor(() =>
      expect(visibleText(container)).toContain("New maneuver"),
    );

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() =>
      expect(visibleText(container)).not.toContain("Preview"),
    );
    expect(visibleText(container)).not.toMatch(/last known orbit/i);
  });
});
