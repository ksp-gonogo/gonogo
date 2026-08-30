import { registerStockBodies } from "@ksp-gonogo/core";
import { Quality, Situation } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { isGroundedSituation, LandingStatusComponent } from "./index";

/**
 * Whether the vessel is ON THE GROUND, which is what voids every descent clock.
 *
 * The verdict comes off the `Situation` ORDINAL. It used to come off the enum
 * NAME, compared against the single literal "Landed", and a vessel that has not
 * launched yet is `PreLaunch`: it failed the test, so the pad ran a live
 * descent evaluation on a craft still on the clamps.
 */

const KERBIN = { index: 1, name: "Kerbin", radius: 600_000, mu: 3.5316e12 };

const CARRIED = [
  "vessel.state",
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.surface",
  "vessel.propulsion",
  "dv.summary",
  "comms.delay",
];

/**
 * Every `Situation` member, and whether it grounds the vessel. Written out in
 * full rather than as a set membership test, so that appending a member to the
 * C# enum without ruling on it here shows up as a missing row.
 */
const CASES: ReadonlyArray<{ situation: Situation; grounded: boolean }> = [
  { situation: Situation.Landed, grounded: true },
  { situation: Situation.Splashed, grounded: true },
  // On the clamps. Not descending, and the reason this file exists.
  { situation: Situation.PreLaunch, grounded: true },
  { situation: Situation.Orbiting, grounded: false },
  { situation: Situation.Escaping, grounded: false },
  { situation: Situation.Flying, grounded: false },
  { situation: Situation.SubOrbital, grounded: false },
  { situation: Situation.Docked, grounded: false },
  // A situation this contract does not recognize is NOT a claim that the
  // vessel is airborne, but it is not a claim that it is down either. The
  // caller falls back to its other grounded signals.
  { situation: Situation.Unknown, grounded: false },
];

describe("the grounded verdict", () => {
  it("covers every member of the Situation enum", () => {
    const ruled = new Set(CASES.map((c) => c.situation));
    const declared = Object.values(Situation).filter(
      (v): v is Situation => typeof v === "number",
    );
    expect([...ruled].sort()).toEqual([...declared].sort());
  });

  for (const { situation, grounded } of CASES) {
    it(`reads ${Situation[situation]} (${situation}) as ${grounded ? "grounded" : "not grounded"}`, () => {
      expect(isGroundedSituation(situation)).toBe(grounded);
    });
  }

  it("claims nothing when the situation has not arrived", () => {
    expect(isGroundedSituation(undefined)).toBe(false);
    expect(isGroundedSituation(null)).toBe(false);
  });
});

describe("LandingStatus on the launchpad", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    registerStockBodies();
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  /**
   * A craft sitting on the pad: still on the clamps, not moving, and a few
   * metres of vessel between its centre of mass and the terrain datum. Those
   * few metres are what the descent solve turns into a free fall.
   */
  function emitOnThePad() {
    act(() => {
      stream.emit("system.bodies", {
        bodies: [
          {
            name: KERBIN.name,
            index: KERBIN.index,
            parentIndex: 0,
            radius: KERBIN.radius,
            orbit: null,
          },
        ],
      });
      stream.emit("vessel.identity", {
        vesselId: "pad-vessel",
        name: "Pad Vessel",
        vesselType: 0,
        situation: Situation.PreLaunch,
        parentBodyIndex: KERBIN.index,
        launchUt: null,
      });
      stream.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: KERBIN.index,
          sma: KERBIN.radius,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 10,
          mu: KERBIN.mu,
        },
        { quality: Quality.Loaded },
      );
      stream.emit("vessel.flight", {
        latitude: 0,
        longitude: 0,
        altitudeAsl: 75,
        altitudeTerrain: 8,
        verticalSpeed: 0,
        surfaceSpeed: 0,
        atmDensity: 1.2,
      });
      stream.emit("vessel.propulsion", {
        totalMass: 20,
        dryMass: 8,
        currentThrust: 0,
        availableThrust: 200,
      });
    });
  }

  it("does not run a descent evaluation on a craft that has not launched", async () => {
    render(
      <stream.Provider>
        <LandingStatusComponent config={{}} id="landing-status" w={12} h={20} />
      </stream.Provider>,
    );
    emitOnThePad();

    // The pad is on the ground, so the widget owes the operator the grounded
    // readout rather than a countdown to an impact that is not coming.
    expect(await screen.findByText("LANDED")).toBeInTheDocument();
    expect(screen.queryByText(/COMMIT IN/i)).toBeNull();
    expect(screen.queryByText(/Blind in/i)).toBeNull();
  });
});
