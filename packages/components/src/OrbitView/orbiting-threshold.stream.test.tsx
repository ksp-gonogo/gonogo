import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitViewComponent } from "./index";

/**
 * Whether a craft counts as ORBITING, which is a claim about its atmosphere.
 *
 * <p>`useIsOrbiting` compares periapsis altitude against the top of the
 * atmosphere, and took that height from the static table of stock bodies. Under
 * a planet pack the lookup missed, the threshold collapsed to zero, and the
 * test became "is the periapsis above sea level", which a craft on its way
 * down passes.</p>
 *
 * <p>The verdict is drawn as the trace's colour: green for orbiting, orange-red
 * for not. So the failure was a confident green ellipse around a vessel about
 * to reenter, which is worse than drawing nothing.</p>
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

const EARTH = {
  index: 1,
  name: "Earth",
  gravParameter: 3.986e14,
  radius: 6371000,
  atmosphere: { depth: 140000, hasOxygen: true, seaLevelPressure: 101.3 },
};

/**
 * `sma`/`ecc` chosen so the periapsis sits INSIDE the 140 km atmosphere and the
 * apoapsis well outside it: rp = 6371+60 km, ra = 6371+400 km. A craft on a
 * decaying pass, not one in orbit.
 */
function setup(sma: number, ecc: number) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
    suspendFrames: true,
  });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ov-orb" }}>
        <OrbitViewComponent id="ov-orb" w={9} h={18} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: 1,
      sma,
      ecc,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 10,
      horizon: ANALYTIC_UNBOUNDED_HORIZON,
      mu: 3.986e14,
    });
    fixture.emit("system.bodies", { bodies: [EARTH] });
    fixture.emit("vessel.identity", {
      vesselId: "ov-orb-vessel",
      name: "Test Vessel",
      vesselType: 0,
      situation: 0,
      parentBodyIndex: 1,
    });
  });
  return fixture;
}

const verdict = () =>
  document.querySelector("[data-orbiting]")?.getAttribute("data-orbiting");

describe("OrbitView orbiting threshold", () => {
  it("does not call a craft orbiting when its periapsis is inside the air", async () => {
    // rp = 6_431 km (60 km altitude, under the 140 km atmosphere), ra = 6_771 km
    setup(6_601_000, 0.0257);
    await waitFor(() => expect(verdict()).toBeDefined());
    expect(verdict()).toBe("no");
  });

  it("calls it orbiting once the periapsis clears the atmosphere", async () => {
    // rp = 6_671 km (300 km altitude, above the 140 km atmosphere)
    setup(6_771_000, 0.0148);
    await waitFor(() => expect(verdict()).toBeDefined());
    expect(verdict()).toBe("yes");
  });
});
