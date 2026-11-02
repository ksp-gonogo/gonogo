import { describe, expect, it } from "vitest";
import {
  type Elements,
  isClosed,
  norm,
  orbitPoints,
  period,
  phaseAngle,
  planeBasis,
  relativeInclination,
  relativeInTargetFrame,
  relativeTrack,
  stateAt,
} from "./kepler";

const MU = 3.5316e12;
const circular = (sma: number, meanAnomaly: number, inc = 0): Elements => ({
  sma,
  ecc: 0,
  inc,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: meanAnomaly,
  epoch: 0,
  mu: MU,
});

describe("stateAt", () => {
  it("keeps a circular orbit at its radius and moves it at the circular speed", () => {
    const o = circular(700_000, 0.7);
    const s = stateAt(o, 120);
    expect(s).not.toBeNull();
    expect(norm(s?.r ?? [0, 0, 0])).toBeCloseTo(700_000, 3);
    expect(norm(s?.v ?? [0, 0, 0])).toBeCloseTo(Math.sqrt(MU / 700_000), 6);
  });

  it("answers null for an open conic", () => {
    expect(stateAt({ ...circular(700_000, 0), ecc: 1.2 }, 0)).toBeNull();
    expect(isClosed({ ...circular(-700_000, 0) })).toBe(false);
  });

  it("walks a full period back to where it started", () => {
    const o = {
      ...circular(900_000, 1),
      ecc: 0.2,
      argPe: 40,
      inc: 20,
      lan: 70,
    };
    const p = period(o) ?? 0;
    const a = stateAt(o, 10);
    const b = stateAt(o, 10 + p);
    for (let i = 0; i < 3; i++) {
      expect(b?.r[i]).toBeCloseTo(a?.r[i] ?? 0, 2);
    }
  });
});

describe("orbitPoints", () => {
  it("closes the loop and holds a circle at its radius", () => {
    const pts = orbitPoints(circular(700_000, 0), 90);
    expect(pts).toHaveLength(91);
    expect(norm(pts[0])).toBeCloseTo(700_000, 3);
    expect(pts[0][0]).toBeCloseTo(pts[90][0], 3);
    for (const p of pts) expect(norm(p)).toBeCloseTo(700_000, 3);
  });
});

describe("relativeInTargetFrame", () => {
  it("puts a craft behind the target on the same orbit at negative along-track", () => {
    const target = circular(700_000, 1);
    const chaser = circular(700_000, 1 - 400 / 700_000);
    const p = relativeInTargetFrame(chaser, target, 0);
    expect(p?.[1]).toBeCloseTo(-400, 1);
    expect(Math.abs(p?.[0] ?? 1)).toBeLessThan(0.2);
    expect(Math.abs(p?.[2] ?? 1)).toBeLessThan(1e-6);
  });

  it("puts a craft in a higher orbit at positive radial", () => {
    const target = circular(700_000, 0);
    const chaser = circular(700_100, 0);
    const p = relativeInTargetFrame(chaser, target, 0);
    expect(p?.[0]).toBeCloseTo(100, 3);
  });
});

describe("phaseAngle and relativeInclination", () => {
  it("is positive when the target leads, by the angle between them at the body", () => {
    const ph = phaseAngle(circular(700_000, 0), circular(700_000, 0.5), 0);
    expect(ph).toBeCloseTo((0.5 * 180) / Math.PI, 6);
    const behind = phaseAngle(circular(700_000, 0.5), circular(700_000, 0), 0);
    expect(behind).toBeCloseTo((-0.5 * 180) / Math.PI, 6);
  });

  it("reads the angle between the two planes", () => {
    const inc = relativeInclination(
      circular(700_000, 0, 0),
      circular(700_000, 1, 10),
      0,
    );
    expect(inc).toBeCloseTo(10, 6);
  });
});

describe("relativeTrack", () => {
  it("is a straight line when a craft closes on the same orbit with a small speed difference", () => {
    const target = circular(700_000, 1);
    const chaser = circular(700_000, 1 - 100 / 700_000);
    const track = relativeTrack(chaser, target, 0, 60, 6);
    expect(track).toHaveLength(7);
    for (const p of track ?? []) expect(Math.abs(p[1] + 100)).toBeLessThan(0.5);
  });
});

describe("planeBasis", () => {
  it("is an orthonormal pair in the equatorial plane for an equatorial orbit", () => {
    const { e1, e2 } = planeBasis(circular(700_000, 0));
    expect(norm(e1)).toBeCloseTo(1, 9);
    expect(norm(e2)).toBeCloseTo(1, 9);
    expect(e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]).toBeCloseTo(0, 9);
    expect(e1[2]).toBeCloseTo(0, 9);
    expect(e2[2]).toBeCloseTo(0, 9);
  });
});
