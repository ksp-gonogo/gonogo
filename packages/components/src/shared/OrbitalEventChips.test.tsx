import { render, screen } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitalEventChips } from "./OrbitalEventChips";

/**
 * The encounter chip counts down to an ABSOLUTE UT, and the wire says so:
 * `vessel.state.encounterTime` is `vessel.orbit.encounter.transitionUt`,
 * carried through unchanged. `SystemView` subtracts the view time before
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
    // vessel.state's carried-channels gate is parent-channel-scoped, so every
    // one of the channel's declared inputs has to be carried before any
    // vessel.state.* field is.
    carriedChannels: [
      "vessel.orbit",
      "vessel.flight",
      "vessel.identity",
      "system.bodies",
      "vessel.control",
      "vessel.target",
      "vessel.comms",
      "vessel.propulsion",
    ],
    pinnedUt: VIEW_UT,
  });
  render(
    <fixture.Provider>
      <OrbitalEventChips />
    </fixture.Provider>,
  );
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
    // TransitionType.Encounter is 2 (VesselEnums.cs), which the client maps to
    // encounterExists 1: the gate the chip branches on.
    encounter: { transitionType: 2, transitionUt, bodyIndex: 2 },
    patches: [],
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

  it("shows no encounter chip once the transition is in the past", async () => {
    // The gate was `encounterTime > 0`, which every absolute UT passes forever.
    // Against the view time it means what it says: an encounter already behind
    // us is not something to count down to.
    mountAt(VIEW_UT - 60);

    await screen.findByText(/NEXT|AP|PE/);
    expect(visibleText()).not.toContain("ENC");
  });
});
