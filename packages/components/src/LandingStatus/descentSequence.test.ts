import { describe, expect, it } from "vitest";
import { integrate, SHALLOW_DESCENT } from "../../scripts/landingDescentModel";
import { solveSuicideBurn } from "./solveLanding";

const MU = 6.5138398e10;
const RADIUS = 200_000;
const THRUST = 18;
/** The best-burn touchdown speed above which the widget reads NO LANDING VECTOR (`useLandingModel`). */
const NO_LANDING_VECTOR_ABOVE_MPS = 0.5;
const MASS = 5;

/** A safe landing is read off the widget's own solve: no frame of it may be one the widget calls a failure, and no speed may change faster than the engine can change it. */
describe.each([
  ["the deep descent", undefined],
  ["the shallow approach", SHALLOW_DESCENT],
])("%s", (_name, start) => {
  const frames = integrate({ start });
  const flying = frames.filter((f) => !f.landed && f.aglMeters > 0);

  it("never reads as a failure to the widget's own solve: a burn started now always lands softly", () => {
    for (const f of flying) {
      const solution = solveSuicideBurn({
        heightFromTerrain: f.aglMeters,
        altitudeAsl: f.aglMeters,
        verticalSpeed: -f.vDown,
        surfaceSpeed: Math.hypot(f.vDown, f.vHoriz),
        mu: MU,
        bodyRadius: RADIUS,
        availableThrust: THRUST,
        totalMass: MASS,
      });
      // The widget calls anything over this a landing no burn can make.
      expect(solution.bestSpeedAtImpact, `t=${f.t}`).toBeLessThanOrEqual(
        NO_LANDING_VECTOR_ABOVE_MPS,
      );
    }
  });

  it("changes no speed faster than the engine can, second to second", () => {
    const aMax = THRUST / MASS;
    for (let i = 1; i < flying.length; i++) {
      const a = flying[i - 1];
      const b = flying[i];
      expect(Math.abs(a.vDown - b.vDown), `vDown t=${b.t}`).toBeLessThanOrEqual(
        aMax + 2,
      );
      expect(a.vHoriz - b.vHoriz, `vHoriz t=${b.t}`).toBeLessThanOrEqual(aMax);
    }
  });

  it("holds the thrust retrograde while there is speed to shed, so the exhaust points along the velocity", () => {
    const burning = flying.filter(
      (f) => f.burning && Math.hypot(f.vDown, f.vHoriz) > 6,
    );
    expect(burning.length).toBeGreaterThan(10);
    for (const f of burning) {
      const thrust = Math.hypot(f.thrustUp ?? 0, f.thrustAlong ?? 0);
      const speed = Math.hypot(f.vDown, f.vHoriz);
      // Direction cosine between the thrust and the way the craft is NOT moving.
      const cosine =
        ((f.thrustUp ?? 0) * f.vDown + (f.thrustAlong ?? 0) * -f.vHoriz) /
        (thrust * speed);
      expect(cosine, `t=${f.t}`).toBeGreaterThan(0.99);
    }
  });

  it("ends on a settled touchdown", () => {
    const last = frames[frames.length - 1];
    expect(last.landed).toBe(true);
    expect(flying[flying.length - 1].vDown).toBeLessThan(5);
    // It is the ground the descent reaches, not the end of the integration.
    expect(flying[flying.length - 1].aglMeters).toBeLessThan(3);
  });
});

describe("the shallow approach", () => {
  it("begins under five degrees below level and travels a long way over the ground", () => {
    const frames = integrate({ start: SHALLOW_DESCENT });
    const first = frames[0];
    expect(
      Math.atan2(first.vDown, first.vHoriz) * (180 / Math.PI),
    ).toBeLessThan(5);
    const lon = frames[frames.length - 1].lon - first.lon;
    expect((lon * Math.PI * RADIUS) / 180).toBeGreaterThan(1_500);
  });
});
