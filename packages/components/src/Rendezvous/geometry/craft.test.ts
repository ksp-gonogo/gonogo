import { describe, expect, it } from "vitest";
import { APART_SHARE, craftGeometry, orbitSpread } from "./craft";
import type { Elements } from "./kepler";

const MU = 3.5316e12;
const circular = (sma: number, meanAnomaly: number): Elements => ({
  sma,
  ecc: 0,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: meanAnomaly,
  epoch: 0,
  mu: MU,
});

describe("craftGeometry", () => {
  const target = circular(700_000, 1);
  const chaser = circular(700_000, 1 - 400 / 700_000);

  it("draws two craft sharing one orbit as one line, 400 m apart", () => {
    const g = craftGeometry({ chaser, target, ut: 0 });
    expect(g).not.toBeNull();
    expect(g?.apart).toBe(false);
    expect(g?.range).toBeCloseTo(400, 1);
    expect(g?.relative[1]).toBeCloseTo(-400, 1);
    expect(g?.phase).toBeCloseTo((400 / 700_000) * (180 / Math.PI), 4);
  });

  it("draws a target in another orbit as two lines", () => {
    const g = craftGeometry({
      chaser: circular(700_000, 0),
      target: circular(800_000, 0.4),
      ut: 0,
    });
    expect(g?.apart).toBe(true);
  });

  it("answers null for an escape trajectory", () => {
    expect(
      craftGeometry({ chaser: { ...chaser, ecc: 1.5 }, target, ut: 0 }),
    ).toBeNull();
  });

  it("marks the target's place at a closest approach still ahead, and ignores one already past", () => {
    const ahead = craftGeometry({
      chaser,
      target,
      ut: 0,
      approach: { time: 60, distance: 12 },
    });
    expect(ahead?.plane.targetAtApproach).not.toBeNull();
    expect(ahead?.approachRelative).not.toBeNull();
    expect(ahead?.approach?.distance).toBe(12);
    const past = craftGeometry({
      chaser,
      target,
      ut: 100,
      approach: { time: 60, distance: 12 },
    });
    expect(past?.plane.targetAtApproach).toBeNull();
    expect(past?.approach).toBeNull();
  });

  it("predicts a track of 61 points", () => {
    expect(craftGeometry({ chaser, target, ut: 0 })?.track).toHaveLength(61);
  });
});

describe("orbitSpread", () => {
  it("is zero for the same line and above the apart share for a clearly different one", () => {
    const circle = (r: number): [number, number][] =>
      Array.from({ length: 60 }, (_, k) => [
        r * Math.cos(k / 9.5),
        r * Math.sin(k / 9.5),
      ]);
    expect(orbitSpread(circle(100), circle(100))).toBeCloseTo(0, 9);
    expect(orbitSpread(circle(100), circle(120))).toBeGreaterThan(APART_SHARE);
  });
});
