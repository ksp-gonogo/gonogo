import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

/** Where the craft is under physics, KSP's own countdown to apoapsis is what the planner reads, so a near-circular orbit that scatters it sample to sample has no apsis to burn at. */

function mount() {
  const fixture = setupStreamFixture({ pinnedUt: 90_000, suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "mnv-apsis" }}>
        <ManeuverPlannerComponent id="mnv-apsis" config={{}} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("trackingStation.bodies", {
      bodies: [{ index: 1, name: "Kerbin", radius: 600_000 }],
    });
  });
  return fixture;
}

function sample(
  fixture: ReturnType<typeof mount>,
  timeToAp: number,
  timeToPe: number,
  shape: { sma: number; ecc: number } = { sma: 700_000, ecc: 0.0001 },
) {
  act(() => {
    fixture.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 1,
        sma: shape.sma,
        ecc: shape.ecc,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 90_000,
        mu: 3.5316e12,
        timeToAp,
        timeToPe,
        horizon: ANALYTIC_UNBOUNDED_HORIZON,
      },
      { quality: Quality.Loaded },
    );
  });
}

function burnIn(): string | null {
  return screen.getByText("Burn in").nextElementSibling?.textContent ?? null;
}

describe("Maneuver Planner BURN IN on a near-circular orbit", () => {
  it("counts down while successive samples agree on the apsis", async () => {
    const fixture = mount();
    for (const t of [1345, 1345.2, 1344.9, 1345.1]) sample(fixture, t, 4000);
    await waitFor(() => expect(burnIn()).not.toBeNull());
    expect(burnIn()).not.toBe(NULL_DISPLAY);
  });

  it("shows a dash once successive samples scatter the apsis by more than a second", async () => {
    const fixture = mount();
    for (const t of [1345, 1328, 1352, 1337]) sample(fixture, t, 4000);
    await waitFor(() => expect(burnIn()).toBe(NULL_DISPLAY));
  });
});

describe("Maneuver Planner BURN IN on an eccentric orbit", () => {
  // 100 x 2000 km about Kerbin: the apsis is a place the elements fix, so scatter in the countdown does not undefine it.
  const ECCENTRIC = { sma: 1_650_000, ecc: 0.5758 };

  it("counts down although successive samples scatter the apsis by more than a second", async () => {
    const fixture = mount();
    for (const t of [2123, 2118, 2127, 2120]) {
      sample(fixture, t, 5000, ECCENTRIC);
    }
    await waitFor(() => expect(burnIn()).not.toBeNull());
    expect(burnIn()).not.toBe(NULL_DISPLAY);
  });
});
