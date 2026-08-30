import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitViewComponent } from "./index";

/**
 * Whether the atmosphere band is drawn as breathable.
 *
 * <p>The flag used to be decided by comparing the body's NAME against the two
 * stock oxygen-bearing bodies, with a comment saying it would be replaced "when
 * the static body registry grows a `hasOxygen` field". The registry never grew
 * one and was never going to: the flag arrives on the WIRE, per body, and has
 * since `SystemViewProvider` started writing `atmosphereHasOxygen`.</p>
 *
 * <p>The visible cost of the name comparison was a wrong readout rather than a
 * missing one, which is the worse kind: under RSS, Earth's atmosphere drew in
 * the inert colour, stating positively that the air is not breathable.</p>
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

/** One body, named and described entirely by the stream. */
function setup(body: Record<string, unknown>) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
    suspendFrames: true,
  });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ov-o2" }}>
        <OrbitViewComponent id="ov-o2" w={9} h={18} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: 1,
      sma: 7000000,
      ecc: 0.01,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 10,
      horizon: ANALYTIC_UNBOUNDED_HORIZON,
      mu: 3.986e14,
    });
    fixture.emit("system.bodies", { bodies: [body] });
    /* `parentBodyName` is what the widget resolves the body by, and it is
       derived from this index against the roster above. */
    fixture.emit("vessel.identity", {
      vesselId: "ov-o2-vessel",
      name: "Test Vessel",
      vesselType: 0,
      situation: 0,
      parentBodyIndex: 1,
    });
  });
  return fixture;
}

const band = () => document.querySelector("[data-atmosphere]");

describe("OrbitView atmosphere shading", () => {
  /*
   * The body a planet pack actually presents: a name no stock table carries,
   * with breathable air. This is the case the name comparison got backwards.
   */
  it("draws breathable air for a body only the stream names", async () => {
    setup({
      index: 1,
      name: "Earth",
      gravParameter: 3.986e14,
      radius: 6371000,
      atmosphere: { depth: 140000, hasOxygen: true },
    });
    await waitFor(() => expect(band()).not.toBeNull());
    expect(band()?.getAttribute("data-atmosphere")).toBe("oxygen");
  });

  it("draws inert air when the stream says the air is not breathable", async () => {
    setup({
      index: 1,
      name: "Duna",
      gravParameter: 3.0136e11,
      radius: 320000,
      atmosphere: { depth: 50000, hasOxygen: false },
    });
    await waitFor(() => expect(band()).not.toBeNull());
    expect(band()?.getAttribute("data-atmosphere")).toBe("inert");
  });
});
