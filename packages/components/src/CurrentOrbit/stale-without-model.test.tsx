import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CurrentOrbitComponent } from "./index";

/**
 * A stale orbit with no model draws nothing: the widget claims where the craft is now, and an element that stopped arriving does not support that.
 * A stale reading with a model is a different case: the conic moves the phase over constants of the orbit, so the answer is current.
 */
describe("CurrentOrbit: a stale orbit with no model", () => {
  it("draws nothing rather than holding the last elements", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "orbit-stale" }}>
          <CurrentOrbitComponent id="orbit-stale" w={9} h={18} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Measured rather than hard-coded, since the count depends on the channels the fixture carries.
    const placeholdersWhenEmpty = screen.getAllByText(NULL_DISPLAY).length;

    act(() => {
      fixture.emit("vessel.orbit", {
        sma: 682500,
        ecc: 0.00367,
        inc: 0.3,
        argPe: 12.5,
        mu: 3.5316e12,
        // Unbounded reach and no stated shape, so the model declines on the elements themselves.
        horizon: UNBOUNDED_HORIZON,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
      });
    });

    // It really did arrive and really was drawn, so the disappearance below is a change rather than a field that was never there.
    await waitFor(() => expect(visibleText()).toContain("0.3°"));

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    const reading = () => fixture.store.sampleReading("vessel.orbit");

    // Both halves of the premise: the stream stopped, and no model answered.
    await waitFor(() => expect(reading().state).toBe("stale"));
    expect(reading().reckoning.status).not.toBe("available");

    // The elements, named individually; the solved rows are pinned by the count below.
    expect(visibleText()).not.toContain("0.3°"); // inclination
    expect(visibleText()).not.toContain("0.00367"); // eccentricity
    for (const row of ["Ap", "Pe", "Inc", "Ecc"]) {
      expect(visibleText(), `${row} row`).toContain(`${row}${NULL_DISPLAY}`);
    }

    // The solved rows null with the elements, so the count equals the never-arrived baseline.
    expect(screen.getAllByText(NULL_DISPLAY).length).toBe(
      placeholdersWhenEmpty,
    );
  });
});
