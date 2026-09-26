import { act, render, screen } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitalEventChips } from "./OrbitalEventChips";

/**
 * The encounter chip counts down to an ABSOLUTE UT, and the wire says so:
 * `vessel.orbit.encounter.transitionUt` is an instant, not a duration. `SystemView` subtracts the view time before
 * rendering it and says why in a comment; this component, which the same
 * field reaches through `TargetPicker` and `MapView`, did not.
 *
 * The unit token cannot tell the two apart. `Units.Seconds` is `"s"` on an
 * absolute instant and on a duration alike, so nothing catches this at the
 * boundary and the same mistake is available at every one of the thirty-odd
 * absolute-UT fields in the contract.
 */

/** An orbit whose SOI transition is twenty minutes after the view time. */
const VIEW_UT = 1_000_000;
const TRANSITION_UT = VIEW_UT + 1200;

function mountAt(transitionUt: number) {
  const fixture = setupStreamFixture({
    carriedChannels: ["vessel.orbit"],
    pinnedUt: VIEW_UT,
    suspendFrames: true,
  });
  render(
    <fixture.Provider>
      <OrbitalEventChips />
    </fixture.Provider>,
  );
  /*
   * Inside `act`, because the fixture's clock is suspended and each emit
   * therefore publishes on the spot rather than on some later frame: the render
   * it causes happens here, in this scope, and has to be allowed to.
   */
  act(() => {
    fixture.emit("system.bodies", {
      bodies: [
        { name: "Kerbin", index: 1 },
        { name: "Mun", index: 2 },
      ],
    });
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: 1,
      sma: 700_000,
      ecc: 0,
      inc: 0,
      lan: null,
      argPe: null,
      meanAnomalyAtEpoch: 0,
      epoch: VIEW_UT,
      mu: 3.5316e12,
      // TransitionType.Encounter is 2 (VesselEnums.cs), which the client maps
      // to encounterExists 1: the gate the chip branches on.
      encounter: { transitionType: 2, transitionUt, bodyIndex: 2 },
      patches: [],
    });
  });
  return fixture;
}

describe("OrbitalEventChips", () => {
  it("counts down the time REMAINING to an encounter, not the UT it happens at", async () => {
    mountAt(TRANSITION_UT);

    await screen.findByText(/ENC/);
    const text = visibleText();
    // Twenty minutes away. Rendering the absolute UT instead puts an encounter
    // eleven days out on a craft that reaches the Mun in twenty minutes, and
    // the chip's own `> 0` gate passes for any UT, so nothing else notices.
    expect(text).toMatch(/20:00|20m/);
    expect(text).not.toContain("1000");
  });

  it("shows nothing at all once the transition is in the past", () => {
    // The gate was `encounterTime > 0`, which every absolute UT passes forever.
    // Against the view time it means what it says: an encounter already behind
    // us is not something to count down to.
    //
    // The APSIS chip goes with it, and that is the conic's doing rather than
    // this component's: past the transition these elements describe an orbit
    // round the body the craft has left, so there is no next apsis on them to
    // count down to either. Both claims are about what happens next and both
    // are about the wrong orbit.
    //
    // The test above is this one's control: the same scene with the transition
    // ahead of the view time renders chips, so an empty render here is the
    // gate and not a fixture that delivered nothing.
    mountAt(VIEW_UT - 60);

    expect(visibleText()).toBe("");
  });
});
