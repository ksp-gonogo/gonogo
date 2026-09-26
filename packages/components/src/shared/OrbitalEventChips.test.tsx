import { act, render, screen } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitalEventChips } from "./OrbitalEventChips";

/** An orbit whose SOI transition, an absolute UT, is twenty minutes after the view time. */
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
  // With the clock suspended each emit publishes, and renders, on the spot.
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
      // TransitionType.Encounter is 2.
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
    expect(text).toMatch(/20:00|20m/);
    expect(text).not.toContain("1000");
  });

  it("shows nothing at all once the transition is in the past", () => {
    /* The apsis chip goes too: past the transition these elements describe the
       body the craft has left. The test above is the control that shows the
       same scene renders chips. */
    mountAt(VIEW_UT - 60);

    expect(visibleText()).toBe("");
  });
});
