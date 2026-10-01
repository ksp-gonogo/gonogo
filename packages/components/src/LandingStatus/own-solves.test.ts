import { isTopicId, projectDescent } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { deriveDelayClocks } from "./clocks";
import { type SuicideBurnInputs, solveSuicideBurn } from "./solveLanding";

/**
 * The facts the "Not a reckoner" reasons in `solveLanding.ts`, `clocks.ts`,
 * `descentLayers.ts` and `descent.ts` rest on. If one of these stops holding,
 * the reason is stale and the solve may now be a reckoner's job.
 */

const DESCENDING: SuicideBurnInputs = {
  heightFromTerrain: 4000,
  altitudeAsl: 4000,
  verticalSpeed: -120,
  surfaceSpeed: 150,
  mu: 3.5316e12,
  bodyRadius: 600000,
  availableThrust: 200,
  totalMass: 10,
};

describe("LandingStatus own solves are quantities about an event that has not happened", () => {
  it("solveSuicideBurn is a pure function of its one argument, with no clock to carry a value forward", () => {
    expect(solveSuicideBurn.length).toBe(1);
    const first = solveSuicideBurn(DESCENDING);
    expect(first.state).toBe("vacuum-solved");
    expect(solveSuicideBurn({ ...DESCENDING })).toEqual(first);
  });

  it("the solution is exactly as stale as its inputs: the same measurements give the same ignition point at any later view", () => {
    const solved = solveSuicideBurn(DESCENDING);
    expect(solved.timeToImpact).not.toBeNull();
    expect(solved.suicideBurnCountdown).not.toBeNull();
    expect(solveSuicideBurn(DESCENDING).suicideBurnCountdown).toBe(
      solved.suicideBurnCountdown,
    );
  });

  it("without a descent there is no solution to carry, rather than a stale one", () => {
    expect(solveSuicideBurn({ ...DESCENDING, verticalSpeed: 5 }).state).toBe(
      "not-descending",
    );
  });

  it("deriveDelayClocks subtracts the delay from solved margins and carries nothing forward", () => {
    const clocks = deriveDelayClocks({
      oneWaySeconds: 3,
      suicideBurnCountdown: 40,
      timeToImpact: 50,
    });
    expect(clocks.commitInSeconds).toBe(37);
    expect(clocks.blindInSeconds).toBe(44);
  });

  it("projectDescent takes its atmosphere from the caller and holds none of its own", () => {
    const common = {
      startSpeed: 200,
      startAltitude: 8000,
      surfaceGravity: 9.81,
    };
    const thin = projectDescent({ ...common, terminalVelocityAt: () => 300 });
    const thick = projectDescent({ ...common, terminalVelocityAt: () => 20 });
    expect(thick.touchdownSpeed).toBeLessThan(thin.touchdownSpeed);
  });

  it("projectDescent rides a vessel already on the curve down unchanged, so nothing but the anchors shapes it", () => {
    const onCurve = projectDescent({
      startSpeed: 50,
      startAltitude: 5000,
      surfaceGravity: 9.81,
      terminalVelocityAt: () => 50,
    });
    expect(onCurve.touchdownSpeed).toBeCloseTo(50, 6);
    expect(onCurve.settleAltitude).toBeNull();
  });

  it("no landing solution is a Topic", () => {
    for (const name of [
      "vessel.landingSolution",
      "vessel.suicideBurn",
      "vessel.delayClocks",
      "vessel.descentProjection",
    ]) {
      expect(isTopicId(name)).toBe(false);
    }
  });
});
