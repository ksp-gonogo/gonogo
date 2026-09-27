import {
  PropagationHorizonKind,
  Quality,
  TrajectoryKind,
} from "@ksp-gonogo/sitrep-sdk";
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

describe("OrbitalEventChips under signal delay", () => {
  it("counts down from the received edge, with the conic's figure for the craft's present beside it", async () => {
    const owlt = 240;
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit"],
      delaySeconds: owlt,
      suspendFrames: true,
    });
    render(
      <fixture.Provider>
        <OrbitalEventChips />
      </fixture.Provider>,
    );
    // The frames left the craft a light-time before its present of VIEW_UT.
    const meta = {
      validAt: VIEW_UT - owlt,
      deliveredAt: VIEW_UT,
      quality: Quality.OnRails,
    };
    act(() => {
      fixture.emit(
        "system.bodies",
        {
          bodies: [
            { name: "Kerbin", index: 1 },
            { name: "Mun", index: 2 },
          ],
        },
        meta,
      );
      fixture.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 1,
          sma: 700_000,
          ecc: 0,
          inc: 0,
          lan: null,
          argPe: null,
          meanAnomalyAtEpoch: 0,
          epoch: VIEW_UT - owlt,
          mu: 3.5316e12,
          horizon: {
            kind: PropagationHorizonKind.Unbounded,
            trajectoryKind: TrajectoryKind.Analytic,
          },
          encounter: {
            transitionType: 2,
            transitionUt: TRANSITION_UT,
            bodyIndex: 2,
          },
          patches: [],
        },
        meta,
      );
      fixture.emitFrame();
    });

    await screen.findByText(/ENC/);
    const alongside = document.querySelectorAll("[data-modelled-alongside]");
    expect(visibleText()).toMatch(/24m/);
    expect(alongside[0]?.textContent).toMatch(/20m/);
    expect(
      alongside[0]?.querySelector("[data-held-mark]"),
    ).not.toBeNull();
  });
});
