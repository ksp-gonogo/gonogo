import { describe, expect, it } from "vitest";
import {
  type BodyEntry,
  PropagationHorizonKind,
  TrajectoryKind,
} from "../__generated__/contract";
import { asDeterministic, value } from "../unit-system";
import { deriveTrueAnomalyDeg } from "./body-derivations";
import { poseAtIndex, systemPosesAt } from "./body-pose";
import { deriveCelestialFacts } from "./celestial-facts";
import type { Vec3Tuple } from "./kepler";
import { systemInstantAt } from "./reference-frame";

const STAR_MU = 1.327e20;
const PLANET_MU = 3.986e14;
const MOON_MU = 4.905e12;
const AU = 1.496e11;
const LUNAR_DISTANCE = 3.844e8;

/** The end of the planet's stated horizon; the moon's own elements hold longer. */
const PLANET_UNTIL = 1_000;
const MOON_UNTIL = 5_000;

interface Spec {
  index: number;
  name: string;
  parentIndex?: number;
  mu: number;
  sma?: number;
  ecc?: number;
  meanAnomalyAtEpoch?: number;
  until?: number;
}

/** A figure the way a stock host stamps it, exact at any instant, or the plain measurement an n-body host sends. */
function figure(magnitude: number, deterministic: boolean) {
  const v = value("m", magnitude);
  return deterministic ? asDeterministic(v) : v;
}

function entry(spec: Spec, deterministic: boolean): BodyEntry {
  const orbit =
    spec.sma === undefined
      ? undefined
      : {
          sma: figure(spec.sma, deterministic),
          ecc: figure(spec.ecc ?? 0, deterministic),
          inc: figure(0, deterministic),
          lan: figure(0, deterministic),
          argPe: figure(0, deterministic),
          meanAnomalyAtEpoch: figure(
            spec.meanAnomalyAtEpoch ?? 0,
            deterministic,
          ),
          epoch: figure(0, deterministic),
        };
  return {
    index: spec.index,
    name: spec.name,
    parentIndex: spec.parentIndex,
    gravParameter: value("m³/s²", spec.mu),
    orbit,
    horizon:
      spec.until === undefined
        ? undefined
        : {
            kind: PropagationHorizonKind.Until,
            trajectoryKind: TrajectoryKind.Integrated,
            untilUt: value("ut", spec.until),
          },
  } as BodyEntry;
}

const SYSTEM: readonly Spec[] = [
  { index: 0, name: "Star", mu: STAR_MU },
  { index: 1, name: "Home", parentIndex: 0, mu: PLANET_MU, sma: AU },
  {
    index: 2,
    name: "Moon",
    parentIndex: 1,
    mu: MOON_MU,
    sma: LUNAR_DISTANCE,
    ecc: 0.05,
    meanAnomalyAtEpoch: 1,
  },
];

function factsOf(specs: readonly Spec[], deterministic: boolean) {
  return deriveCelestialFacts(specs.map((s) => entry(s, deterministic)));
}

const withUntil = (until: Record<number, number>): Spec[] =>
  SYSTEM.map((s) => (s.index in until ? { ...s, until: until[s.index] } : s));

function distance(a: Vec3Tuple, b: Vec3Tuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe("systemPosesAt: a body on a fixed orbit", () => {
  const facts = factsOf(SYSTEM, true);

  it("is exact at any instant, however far on", () => {
    const poses = systemPosesAt(facts, 9e9, null);
    for (const index of [0, 1, 2]) {
      const pose = poseAtIndex(poses, index);
      expect(pose?.currency).toBe("exact");
      expect(pose?.atUt).toBe(9e9);
      expect(pose?.asOfUt).toBeNull();
    }
  });

  it("stays exact when the catalogue it came from stopped arriving long ago", () => {
    const poses = systemPosesAt(facts, 5_000, 10);
    expect(poseAtIndex(poses, 1)?.currency).toBe("exact");
    expect(poseAtIndex(poses, 1)?.atUt).toBe(5_000);
  });

  it("places every body where the frame arithmetic does", () => {
    const poses = systemPosesAt(facts, 123_456, null);
    const system = systemInstantAt(facts, 123_456);
    for (const index of [0, 1, 2]) {
      const pose = poseAtIndex(poses, index);
      const expected = system.positionByIndex.get(index) as Vec3Tuple;
      expect(distance(pose?.position as Vec3Tuple, expected)).toBeLessThan(
        1e-3,
      );
    }
  });

  it("carries the anomaly along the orbit at the instant it is placed", () => {
    const pose = poseAtIndex(systemPosesAt(facts, 777_777, null), 2);
    expect(pose?.trueAnomaly).toBeCloseTo(
      deriveTrueAnomalyDeg({
        semiMajorAxis: LUNAR_DISTANCE,
        eccentricity: 0.05,
        meanAnomalyAtEpoch: 1,
        epoch: 0,
        parentGravParameter: PLANET_MU,
        ut: 777_777,
      }) ?? Number.NaN,
      9,
    );
  });

  it("has no anomaly for the root star, which is the origin", () => {
    const star = poseAtIndex(systemPosesAt(facts, 10, null), 0);
    expect(star?.position).toEqual([0, 0, 0]);
    expect(star?.trueAnomaly).toBeNull();
  });
});

describe("systemPosesAt: a body whose position is a model", () => {
  const facts = factsOf(withUntil({ 1: PLANET_UNTIL, 2: MOON_UNTIL }), false);

  it("is modelled inside its horizon, saying how far it holds", () => {
    const pose = poseAtIndex(systemPosesAt(facts, PLANET_UNTIL - 1, null), 1);
    expect(pose?.currency).toBe("modelled");
    expect(pose?.untilUt).toBe(PLANET_UNTIL);
    expect(pose?.asOfUt).toBeNull();
  });

  it("holds a body past its horizon at the instant it last held, rather than advancing it", () => {
    const past = poseAtIndex(
      systemPosesAt(facts, PLANET_UNTIL + 4_000, null),
      1,
    );
    const atHorizon = poseAtIndex(systemPosesAt(facts, PLANET_UNTIL, null), 1);
    expect(past?.currency).toBe("held");
    expect(past?.asOfUt).toBe(PLANET_UNTIL);
    expect(past?.atUt).toBe(PLANET_UNTIL);
    expect(past?.position).toEqual(atHorizon?.position);
    expect(past?.trueAnomaly).toBe(atHorizon?.trueAnomaly);
  });

  it("holds a moon with its planet, even while the moon's own elements still hold", () => {
    const poses = systemPosesAt(facts, PLANET_UNTIL + 2_000, null);
    const moon = poseAtIndex(poses, 2);
    const planet = poseAtIndex(poses, 1);
    expect(moon?.currency).toBe("held");
    expect(moon?.asOfUt).toBe(PLANET_UNTIL);
    expect(moon?.untilUt).toBe(MOON_UNTIL);
    const apart = distance(
      moon?.position as Vec3Tuple,
      planet?.position as Vec3Tuple,
    );
    expect(apart).toBeGreaterThanOrEqual(LUNAR_DISTANCE * 0.95 - 1);
    expect(apart).toBeLessThanOrEqual(LUNAR_DISTANCE * 1.05 + 1);
  });

  it("holds a moon at its own horizon when only the moon has run out", () => {
    const onlyMoon = factsOf(withUntil({ 2: MOON_UNTIL }), false);
    const poses = systemPosesAt(onlyMoon, MOON_UNTIL + 3_000, null);
    const planet = poseAtIndex(poses, 1);
    const moon = poseAtIndex(poses, 2);
    expect(planet?.currency).toBe("modelled");
    expect(planet?.atUt).toBe(MOON_UNTIL + 3_000);
    expect(moon?.currency).toBe("held");
    expect(moon?.asOfUt).toBe(MOON_UNTIL);
  });

  it("holds every modelled body at the catalogue's age once the catalogue stopped arriving", () => {
    const open = factsOf(SYSTEM, false);
    const poses = systemPosesAt(open, 9_000, 400);
    const planet = poseAtIndex(poses, 1);
    expect(planet?.currency).toBe("held");
    expect(planet?.asOfUt).toBe(400);
    expect(planet?.position).toEqual(
      poseAtIndex(systemPosesAt(open, 400, null), 1)?.position,
    );
  });

  it("does not call a catalogue held for an instant it was still current at", () => {
    const open = factsOf(SYSTEM, false);
    const pose = poseAtIndex(systemPosesAt(open, 300, 400), 1);
    expect(pose?.currency).toBe("modelled");
    expect(pose?.atUt).toBe(300);
  });
});

describe("systemPosesAt: nothing to place", () => {
  it("withdraws a body whose elements the catalogue has not filled, and its moons", () => {
    const bare: Spec[] = [
      { index: 0, name: "Star", mu: STAR_MU },
      { index: 1, name: "Home", parentIndex: 0, mu: PLANET_MU },
      {
        index: 2,
        name: "Moon",
        parentIndex: 1,
        mu: MOON_MU,
        sma: LUNAR_DISTANCE,
      },
    ];
    const poses = systemPosesAt(factsOf(bare, true), 100, null);
    expect(poseAtIndex(poses, 0)?.currency).toBe("exact");
    for (const index of [1, 2]) {
      const pose = poseAtIndex(poses, index);
      expect(pose?.currency).toBe("withdrawn");
      expect(pose?.position).toBeNull();
      expect(pose?.atUt).toBeNull();
    }
  });

  it("withdraws every body at an instant that is not a time", () => {
    const poses = systemPosesAt(factsOf(SYSTEM, true), Number.NaN, null);
    expect(poseAtIndex(poses, 1)?.currency).toBe("withdrawn");
  });

  it("answers null for a body the instant has no pose for", () => {
    const poses = systemPosesAt(factsOf(SYSTEM, true), 0, null);
    expect(poseAtIndex(poses, 99)).toBeNull();
    expect(poseAtIndex(undefined, 1)).toBeNull();
  });
});
