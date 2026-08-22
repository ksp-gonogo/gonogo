import { describe, expect, it } from "vitest";
import type { CelestialBody, CelestialFacts } from "./celestial-facts";
import type { Vector3 } from "./kepler";
import {
  LAGRANGE_POINT_NAMES,
  LIBRATION_REFUSALS,
  lagrangePointsAt,
  librationOffsetOf,
  librationPairLabel,
  librationPairsOf,
  librationPositionsFor,
} from "./lagrange";
import { frameInstantAt, systemInstantAt, toFrame } from "./reference-frame";

/**
 * The pair is the frame, so every test here names ONE body and lets the pair
 * follow, which is the shape the widget's single control has too.
 *
 * The load-bearing test is `holds every marker still ...`: a libration point
 * that moves is not a libration point, and the pair it is measured over is
 * ECCENTRIC on purpose. Over a circular pair the separation never changes, so
 * every scale convention agrees and the assertion would pass on code that was
 * wrong. The eccentric pair is the only one that discriminates, and there is a
 * paired test that redoes the same transform under the convention this module
 * rejected and asserts it drifts.
 */

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;
const MUN_MU = 6.5138398e10;

function body(over: Partial<CelestialBody> & { index: number }): CelestialBody {
  return {
    index: over.index,
    name: null,
    referenceBody: null,
    radius: null,
    soi: null,
    gravParameter: null,
    semiMajorAxis: null,
    eccentricity: null,
    inclination: null,
    lan: null,
    argumentOfPeriapsis: null,
    meanAnomalyAtEpoch: null,
    epoch: null,
    period: null,
    trueAnomaly: null,
    mass: null,
    geeASL: null,
    escapeVelocity: null,
    hillSphere: null,
    rotationPeriod: null,
    tidallyLocked: null,
    rotates: null,
    hasOcean: null,
    description: null,
    atmosphere: null,
    hasAtmosphere: null,
    maxAtmosphere: null,
    hasOxygen: null,
    ...over,
  };
}

function factsOf(bodies: CelestialBody[]): CelestialFacts {
  const nameByIndex: Record<number, string> = {};
  const indexByName: Record<string, number> = {};
  for (const b of bodies) {
    if (b.name === null) continue;
    nameByIndex[b.index] = b.name;
    indexByName[b.name] = b.index;
  }
  return { bodies, nameByIndex, indexByName };
}

/** Kerbol, Kerbin, and a Mun on an orbit of the caller's chosen eccentricity. */
function kerbinSystem(munEcc: number): CelestialFacts {
  return factsOf([
    body({ index: 0, name: "Kerbol", gravParameter: KERBOL_MU }),
    body({
      index: 1,
      name: "Kerbin",
      referenceBody: "Kerbol",
      gravParameter: KERBIN_MU,
      semiMajorAxis: 13_599_840_256,
      eccentricity: 0,
      inclination: 0,
      lan: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 3.14,
      epoch: 0,
    }),
    body({
      index: 2,
      name: "Mun",
      referenceBody: "Kerbin",
      gravParameter: MUN_MU,
      semiMajorAxis: 12_000_000,
      eccentricity: munEcc,
      inclination: 0,
      lan: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
    }),
  ]);
}

/** Mun's orbital period about Kerbin, so a sample sweep covers a real revolution. */
const MUN_PERIOD = 2 * Math.PI * Math.sqrt(12_000_000 ** 3 / KERBIN_MU);

function norm(v: Vector3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function separation(a: Vector3, b: Vector3): number {
  return norm([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
}

describe("librationPositionsFor", () => {
  it("solves collinear roots that satisfy the equilibrium equation they came from", () => {
    // The residual is the physics; re-evaluating it at the returned roots is an
    // independent check of the solver rather than a restatement of its output.
    const mu = 0.0121505856; // Earth-Moon, the ratio every textbook quotes
    const points = librationPositionsFor(mu);
    expect(points).not.toBeNull();
    if (points === null) return;
    const residual = (x: number): number => {
      const dp = Math.abs(x + mu);
      const ds = Math.abs(x - 1 + mu);
      return (
        x -
        ((1 - mu) * (x + mu)) / (dp * dp * dp) -
        (mu * (x - 1 + mu)) / (ds * ds * ds)
      );
    };
    for (const name of ["L1", "L2", "L3"] as const) {
      const point = points.find((p) => p.name === name);
      expect(point).toBeDefined();
      expect(Math.abs(residual(point?.frame[0] ?? Number.NaN))).toBeLessThan(
        1e-9,
      );
    }
  });

  it("puts the collinear points on the sides of the pair they belong on", () => {
    const mu = 0.0121505856;
    const points = librationPositionsFor(mu);
    if (points === null) throw new Error("no points");
    const x = (name: string) =>
      points.find((p) => p.name === name)?.frame[0] ?? Number.NaN;
    const primaryX = -mu;
    const secondaryX = 1 - mu;
    // L1 between the two, L2 beyond the secondary, L3 beyond the primary.
    expect(x("L1")).toBeGreaterThan(primaryX);
    expect(x("L1")).toBeLessThan(secondaryX);
    expect(x("L2")).toBeGreaterThan(secondaryX);
    expect(x("L3")).toBeLessThan(primaryX);
    // Earth-Moon L1 and L2 sit about 15% of the separation either side of the
    // Moon, and L3 a touch beyond the far side of the Earth.
    expect(secondaryX - x("L1")).toBeCloseTo(0.1509, 3);
    expect(x("L2") - secondaryX).toBeCloseTo(0.1678, 3);
    expect(x("L3")).toBeCloseTo(-1.00506, 4);
  });

  it("puts L4 and L5 on an equilateral triangle with the two bodies", () => {
    const mu = 0.2;
    const points = librationPositionsFor(mu);
    if (points === null) throw new Error("no points");
    const primary: Vector3 = [-mu, 0, 0];
    const secondary: Vector3 = [1 - mu, 0, 0];
    for (const name of ["L4", "L5"] as const) {
      const p = points.find((q) => q.name === name)?.frame;
      if (p === undefined) throw new Error(name);
      expect(separation(p, primary)).toBeCloseTo(1, 12);
      expect(separation(p, secondary)).toBeCloseTo(1, 12);
    }
  });

  it("refuses a mass ratio that is not a ratio", () => {
    expect(librationPositionsFor(0)).toBeNull();
    expect(librationPositionsFor(1)).toBeNull();
    expect(librationPositionsFor(Number.NaN)).toBeNull();
  });
});

describe("lagrangePointsAt refusals", () => {
  it("says nothing was attempted, distinctly, when no pair was named", () => {
    const answer = lagrangePointsAt(kerbinSystem(0.2), null, 0);
    expect(answer.refusal).toBe(LIBRATION_REFUSALS.NotAttempted);
    expect(LIBRATION_REFUSALS.NotAttempted).toBe(0);
    expect(answer.pair).toBeNull();
    expect(answer.because).toBe("");
    expect(answer.points).toHaveLength(0);
  });

  it("names the pair it could not find when the catalogue does not carry the body", () => {
    const answer = lagrangePointsAt(kerbinSystem(0.2), 99, 0);
    expect(answer.refusal).toBe(LIBRATION_REFUSALS.PairUnknown);
    expect(answer.because).toContain("99");
    expect(answer.points).toHaveLength(0);
  });

  it("says WHICH body cannot be half of a pair, and why, for the root star", () => {
    const answer = lagrangePointsAt(kerbinSystem(0.2), 0, 0);
    expect(answer.refusal).toBe(LIBRATION_REFUSALS.RootHasNoPair);
    expect(answer.because).toContain("Kerbol");
    expect(answer.because).toContain("orbits nothing");
    // The pair is reported as far as it goes: the body is known, its partner
    // does not exist. A null pair would have said the body was unknown too.
    expect(answer.pair?.secondaryName).toBe("Kerbol");
    expect(answer.pair?.primaryName).toBeNull();
  });

  it("names the pair when a side carries no gravitational parameter", () => {
    const facts = kerbinSystem(0.2);
    const mun = facts.bodies.find((b) => b.index === 2);
    if (mun === undefined) throw new Error("no Mun");
    mun.gravParameter = null;
    const answer = lagrangePointsAt(facts, 2, 0);
    expect(answer.refusal).toBe(LIBRATION_REFUSALS.NotComputable);
    expect(answer.because).toContain("Kerbin-Mun");
    expect(answer.points).toHaveLength(0);
    // Distinct from "nothing was attempted", which is the whole point of the
    // zero value meaning something true.
    expect(answer.refusal).not.toBe(LIBRATION_REFUSALS.NotAttempted);
  });

  it("names the pair when the parent it claims is not in the catalogue", () => {
    const facts = kerbinSystem(0.2);
    const mun = facts.bodies.find((b) => b.index === 2);
    if (mun === undefined) throw new Error("no Mun");
    mun.referenceBody = "Ghost";
    const answer = lagrangePointsAt(facts, 2, 0);
    expect(answer.refusal).toBe(LIBRATION_REFUSALS.PairUnknown);
    expect(answer.because).toContain("Ghost");
  });
});

describe("lagrangePointsAt", () => {
  it("computes five points for a real pair, and reports the pair it used", () => {
    const answer = lagrangePointsAt(kerbinSystem(0.2), 2, 0);
    expect(answer.refusal).toBe(LIBRATION_REFUSALS.NotRefused);
    expect(answer.because).toBe("");
    expect(answer.points.map((p) => p.name)).toEqual([...LAGRANGE_POINT_NAMES]);
    expect(answer.pair?.primaryName).toBe("Kerbin");
    expect(answer.pair?.secondaryName).toBe("Mun");
    // The frame that was sought is the pair's own rotating-pulsating one, and
    // the body it is parameterised by is the secondary. One choice, not two.
    expect(answer.frameChoice).toEqual({
      kind: "rotating-pulsating",
      bodyIndex: 2,
    });
    // Mun's own system is one body against Kerbin's whole primary side.
    expect(answer.massRatio).toBeCloseTo(MUN_MU / (KERBIN_MU + MUN_MU), 12);
  });

  it("keeps L4 equilateral with the two bodies in INERTIAL metres, over an eccentric pair", () => {
    // Frame-independent geometry, so it cannot be satisfied by a consistent
    // mistake in the frame: if the dilatation or the basis were wrong, the
    // triangle would come out unequal in metres.
    const facts = kerbinSystem(0.4);
    for (const ut of [0, MUN_PERIOD / 7, MUN_PERIOD / 3, MUN_PERIOD * 0.83]) {
      const system = systemInstantAt(facts, ut);
      const answer = lagrangePointsAt(facts, 2, ut, system);
      expect(answer.refusal).toBe(LIBRATION_REFUSALS.NotRefused);
      const kerbin = system.positionByIndex.get(1);
      const mun = system.positionByIndex.get(2);
      if (kerbin === undefined || mun === undefined)
        throw new Error("no state");
      const pairSeparation = separation(kerbin, mun);
      for (const name of ["L4", "L5"] as const) {
        const point = answer.points.find((p) => p.name === name);
        if (point === undefined) throw new Error(name);
        // Relative to the separation, because the separation is 12 Mm and an
        // absolute tolerance in metres would say nothing about the fidelity.
        expect(separation(point.inertial, kerbin) / pairSeparation).toBeCloseTo(
          1,
          9,
        );
        expect(separation(point.inertial, mun) / pairSeparation).toBeCloseTo(
          1,
          9,
        );
      }
    }
  });

  it("holds every marker still in the pair's frame across a whole revolution of an ECCENTRIC pair", () => {
    const facts = kerbinSystem(0.4);
    const samples = 24;
    const seen = new Map<string, Vector3[]>();
    const separations: number[] = [];
    for (let i = 0; i < samples; i++) {
      const ut = (MUN_PERIOD * i) / samples;
      const system = systemInstantAt(facts, ut);
      const answer = lagrangePointsAt(facts, 2, ut, system);
      expect(answer.refusal).toBe(LIBRATION_REFUSALS.NotRefused);
      const instant = frameInstantAt(
        facts,
        { kind: "rotating-pulsating", bodyIndex: 2 },
        ut,
        system,
      );
      if (instant === null) throw new Error("no frame");
      separations.push(instant.unitLength);
      for (const point of answer.points) {
        // The long way round on purpose: take the point's INERTIAL position,
        // which moves, and put it back through a frame instant computed fresh
        // at that UT. A test reading the frame coordinates the module already
        // returned would be asserting that a constant is constant.
        const back = toFrame(instant, point.inertial).position;
        const list = seen.get(point.name) ?? [];
        list.push(back);
        seen.set(point.name, list);
      }
    }

    // The pair really is eccentric over the sweep, else the assertion below
    // would hold for a metre-scaled frame too and would prove nothing.
    const minSeparation = Math.min(...separations);
    const maxSeparation = Math.max(...separations);
    expect(maxSeparation / minSeparation).toBeGreaterThan(2);

    for (const name of LAGRANGE_POINT_NAMES) {
      const positions = seen.get(name);
      if (positions === undefined) throw new Error(name);
      expect(positions).toHaveLength(samples);
      const first = positions[0];
      for (const p of positions) {
        expect(separation(p, first)).toBeLessThan(1e-9);
      }
    }
  });

  it("drifts when the same points are read at a separation fixed to one instant", () => {
    // The convention this module rejected, redone here so the choice is
    // discriminated rather than merely stated: divide every point by the
    // separation at the VIEW instant instead of at the point's own.
    const facts = kerbinSystem(0.4);
    const viewUt = 0;
    const viewInstant = frameInstantAt(
      facts,
      { kind: "rotating-pulsating", bodyIndex: 2 },
      viewUt,
    );
    if (viewInstant === null) throw new Error("no frame");
    const drift: number[] = [];
    for (let i = 1; i < 12; i++) {
      const ut = (MUN_PERIOD * i) / 12;
      const answer = lagrangePointsAt(facts, 2, ut);
      const instant = frameInstantAt(
        facts,
        { kind: "rotating-pulsating", bodyIndex: 2 },
        ut,
      );
      if (instant === null) throw new Error("no frame");
      const l4 = answer.points.find((p) => p.name === "L4");
      if (l4 === undefined) throw new Error("no L4");
      // The rejected convention: this instant's rotation, the view instant's
      // length unit.
      const wrong = toFrame(
        { ...instant, unitLength: viewInstant.unitLength },
        l4.inertial,
      ).position;
      drift.push(separation(wrong, l4.frame));
    }
    // Not a nudge: at eccentricity 0.4 the separation swings by more than a
    // factor of two, so the marker walks the better part of a frame unit.
    expect(Math.max(...drift)).toBeGreaterThan(0.3);
  });

  it("stands still over a CIRCULAR pair under both conventions, which is why the eccentric one is the test", () => {
    const facts = kerbinSystem(0);
    const viewInstant = frameInstantAt(
      facts,
      { kind: "rotating-pulsating", bodyIndex: 2 },
      0,
    );
    if (viewInstant === null) throw new Error("no frame");
    for (let i = 1; i < 8; i++) {
      const ut = (MUN_PERIOD * i) / 8;
      const answer = lagrangePointsAt(facts, 2, ut);
      const instant = frameInstantAt(
        facts,
        { kind: "rotating-pulsating", bodyIndex: 2 },
        ut,
      );
      if (instant === null) throw new Error("no frame");
      const l4 = answer.points.find((p) => p.name === "L4");
      if (l4 === undefined) throw new Error("no L4");
      const wrong = toFrame(
        { ...instant, unitLength: viewInstant.unitLength },
        l4.inertial,
      ).position;
      expect(separation(wrong, l4.frame)).toBeLessThan(1e-9);
    }
  });
});

describe("librationOffsetOf", () => {
  it("names the nearest point and calls a craft sitting on it on-station", () => {
    const facts = kerbinSystem(0.2);
    const answer = lagrangePointsAt(facts, 2, 0);
    const l1 = answer.points.find((p) => p.name === "L1");
    if (l1 === undefined) throw new Error("no L1");
    const offset = librationOffsetOf(answer, l1.inertial);
    expect(offset?.nearest).toBe("L1");
    expect(offset?.distanceMetres).toBeCloseTo(0, 6);
    expect(offset?.keeping).toBe("on-station");
  });

  it("calls a craft a few hundred kilometres off L2 drifting, and one in low orbit elsewhere", () => {
    const facts = kerbinSystem(0.2);
    const system = systemInstantAt(facts, 0);
    const answer = lagrangePointsAt(facts, 2, 0, system);
    const l2 = answer.points.find((p) => p.name === "L2");
    const kerbin = system.positionByIndex.get(1);
    if (l2 === undefined || kerbin === undefined) throw new Error("no state");

    const separation = answer.frame?.unitLength ?? Number.NaN;
    const nudge = separation * 0.05;
    const drifting = librationOffsetOf(answer, [
      l2.inertial[0] + nudge,
      l2.inertial[1],
      l2.inertial[2],
    ]);
    expect(drifting?.nearest).toBe("L2");
    expect(drifting?.keeping).toBe("drifting");
    expect(drifting?.distanceUnits).toBeCloseTo(0.05, 6);
    expect(drifting?.distanceMetres).toBeCloseTo(nudge, 3);

    // A craft 700 km above Kerbin is nearest to whichever point the arithmetic
    // says, and is not stationkeeping on any of them.
    const lowOrbit = librationOffsetOf(answer, [
      kerbin[0] + 1_300_000,
      kerbin[1],
      kerbin[2],
    ]);
    expect(lowOrbit?.keeping).toBe("elsewhere");
  });

  it("has nothing to say when the answer was refused", () => {
    const answer = lagrangePointsAt(kerbinSystem(0.2), 0, 0);
    expect(librationOffsetOf(answer, [0, 0, 0])).toBeNull();
  });

  it("has nothing to say about a craft with no finite position", () => {
    const answer = lagrangePointsAt(kerbinSystem(0.2), 2, 0);
    expect(librationOffsetOf(answer, [Number.NaN, 0, 0])).toBeNull();
    expect(librationOffsetOf(answer, null)).toBeNull();
  });
});

describe("librationPairsOf", () => {
  it("offers only pairs the arithmetic will answer for", () => {
    const facts = kerbinSystem(0.2);
    const pairs = librationPairsOf(facts);
    // Kerbol-Kerbin and Kerbin-Mun. The root star is not half of a pair.
    expect(pairs.map(librationPairLabel)).toEqual([
      "Kerbol-Kerbin",
      "Kerbin-Mun",
    ]);
  });

  it("drops a body the arithmetic would refuse rather than offering it", () => {
    const facts = kerbinSystem(0.2);
    const mun = facts.bodies.find((b) => b.index === 2);
    if (mun === undefined) throw new Error("no Mun");
    mun.gravParameter = null;
    expect(librationPairsOf(facts).map(librationPairLabel)).toEqual([
      "Kerbol-Kerbin",
    ]);
    // And the pair the control dropped is the one the answer refuses, so the
    // control and the arithmetic agree about what is offerable.
    expect(lagrangePointsAt(facts, 2, 0).refusal).toBe(
      LIBRATION_REFUSALS.NotComputable,
    );
  });

  it("has no pairs to offer before the catalogue arrives", () => {
    expect(librationPairsOf(undefined)).toEqual([]);
  });
});
