import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CurrentOrbitComponent } from "./index";

/**
 * CurrentOrbit on the real provider pipeline via `StubTransport`. The solved figures resolve off the elements alone; the two apsis altitudes stay absent because no body in the roster carries a radius.
 * `system.bodies` is emitted empty because the conic declares it as an input: an empty roster satisfies the input and still resolves no radius.
 */
describe("CurrentOrbit: genuinely runs off the stream (M3 batch 2)", () => {
  it("reads sma/eccentricity/inclination/argPe/period off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit", "vessel.identity", "system.bodies"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "orbit-stream" }}>
          <CurrentOrbitComponent id="orbit-stream" w={9} h={18} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet, so every row shows its placeholder.
    expect(screen.getAllByText(NULL_DISPLAY).length).toBeGreaterThanOrEqual(6);

    // StubTransport.emit is subscription-gated, so a real subscription must exist for this to deliver.
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);

    // Elapsed time is 0 at this frame, so trueAnomaly is exactly 0 (periapsis).
    const sma = 682500;
    const mu = 3.5316e12; // Kerbin's GM
    act(() => {
      fixture.emit("vessel.orbit", {
        sma,
        ecc: 0.00367,
        inc: 0.3,
        argPe: 12.5,
        mu,
        horizon: ANALYTIC_UNBOUNDED_HORIZON,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
      });
      // The conic's declared input, satisfied and empty.
      fixture.emit("system.bodies", { bodies: [] });
    });

    await waitFor(() => expect(visibleText()).toContain("0.3°"));
    expect(visibleText()).toContain("0.0037");
    // 2π·sqrt(682500³ / 3.5316e12) ≈ 1885.16s, floored.
    await waitFor(() => expect(visibleText()).toContain("31min 25s"));
    // At periapsis timeToPe is 0 and timeToAp is half the period.
    expect(visibleText()).toContain("0s");
    expect(visibleText()).toContain("15min 42s");
    // Only Ap/Pe dash, since their altitudes need a body radius; the absent subtitle renders nothing rather than a dash.
    expect(screen.getAllByText(NULL_DISPLAY).length).toBe(2);
  });
});
