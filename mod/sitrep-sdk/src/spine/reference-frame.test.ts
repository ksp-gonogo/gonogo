import { describe, expect, it } from "vitest";
import type { BodyEntry } from "../__generated__/contract";
import { type CelestialFacts, deriveCelestialFacts } from "./celestial-facts";
import type { Vector3 } from "./kepler";
import {
  frameInstantAt,
  frameSides,
  pointMassAccelerationAt,
  systemInstantAt,
  TRAJECTORY_SCALE_CONVENTIONS,
  toFrame,
} from "./reference-frame";

/** A star heavy enough that a planet's orbit about it takes a recognisable year. */
const STAR_MU = 1.327e20;
/** Earth-ish, so the pair's mass ratio is the one the barycentre maths has to get right. */
const PLANET_MU = 3.986e14;
/** Moon-ish, and deliberately big enough that the pair's barycentre is not the planet. */
const MOON_MU = 4.905e12;

const AU = 1.496e11;
const LUNAR_DISTANCE = 3.844e8;

function value(magnitude: number) {
  return { magnitude } as BodyEntry["gravParameter"];
}

interface BodySpec {
  index: number;
  name: string;
  parentIndex?: number;
  mu: number;
  sma?: number;
  ecc?: number;
  inc?: number;
  lan?: number;
  argPe?: number;
  meanAnomalyAtEpoch?: number;
}

function entry(spec: BodySpec): BodyEntry {
  const orbit =
    spec.sma === undefined
      ? undefined
      : {
          sma: value(spec.sma),
          ecc: value(spec.ecc ?? 0),
          inc: value(spec.inc ?? 0),
          lan: value(spec.lan ?? 0),
          argPe: value(spec.argPe ?? 0),
          meanAnomalyAtEpoch: value(spec.meanAnomalyAtEpoch ?? 0),
          epoch: value(0),
        };
  return {
    index: spec.index,
    name: spec.name,
    parentIndex: spec.parentIndex,
    gravParameter: value(spec.mu),
    orbit,
  } as BodyEntry;
}

function catalogue(specs: readonly BodySpec[]): CelestialFacts {
  return deriveCelestialFacts(specs.map(entry), 0);
}

/**
 * A star, one planet on a circular orbit, one moon about it, and two more
 * planets on either side of the first so the set-building rule has something to
 * stop at. Deliberately NOT in orbital order in the list, because the rule
 * walks the catalogue's own order and a test that only ever sees a sorted one
 * cannot tell the two apart.
 */
const SOLAR: readonly BodySpec[] = [
  { index: 0, name: "Star", mu: STAR_MU },
  { index: 1, name: "Inner", parentIndex: 0, mu: 3.2e13, sma: 0.4 * AU },
  { index: 2, name: "Second", parentIndex: 0, mu: 3.2e14, sma: 0.7 * AU },
  { index: 3, name: "Home", parentIndex: 0, mu: PLANET_MU, sma: AU },
  { index: 4, name: "Moon", parentIndex: 3, mu: MOON_MU, sma: LUNAR_DISTANCE },
  { index: 5, name: "Outer", parentIndex: 0, mu: 4.3e16, sma: 1.5 * AU },
];

function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe("frameSides", () => {
  it("stops the primary side at the selected body, so two planets ride along and the rest do not", () => {
    const facts = catalogue(SOLAR);
    const sides = frameSides(facts, {
      kind: "rotating-pulsating",
      bodyIndex: 3,
    });
    expect(sides).not.toBeNull();
    // Star, Inner and Second come before Home in the catalogue's own order;
    // Outer is past the stop and is excluded. Publishing "Star" alone would
    // lose two bodies out of the mass that decides where the origin sits.
    expect(sides?.primary).toEqual([0, 1, 2]);
    expect(sides?.secondary).toEqual([3, 4]);
  });

  it("keeps a moon's system on the secondary side", () => {
    const facts = catalogue(SOLAR);
    const sides = frameSides(facts, {
      kind: "rotating-pulsating",
      bodyIndex: 4,
    });
    expect(sides?.primary).toEqual([3]);
    expect(sides?.secondary).toEqual([4]);
  });

  it("gives a rotating frame one body a side", () => {
    const facts = catalogue(SOLAR);
    expect(
      frameSides(facts, { kind: "parent-direction", bodyIndex: 4 }),
    ).toEqual({
      primary: [4],
      secondary: [3],
    });
  });

  it("refuses a rotating frame on the root body, which has no parent to rotate about", () => {
    const facts = catalogue(SOLAR);
    expect(
      frameSides(facts, { kind: "parent-direction", bodyIndex: 0 }),
    ).toBeNull();
    expect(
      frameSides(facts, { kind: "rotating-pulsating", bodyIndex: 0 }),
    ).toBeNull();
  });

  it("refuses a body the catalogue does not carry", () => {
    const facts = catalogue(SOLAR);
    expect(
      frameSides(facts, { kind: "parent-direction", bodyIndex: 99 }),
    ).toBeNull();
  });
});

describe("systemInstantAt", () => {
  it("places a moon at its parent's position plus its own orbit, not at the root", () => {
    const facts = catalogue(SOLAR);
    const system = systemInstantAt(facts, 0);
    const home = system.positionByIndex.get(3);
    const moon = system.positionByIndex.get(4);
    expect(home).toBeDefined();
    expect(moon).toBeDefined();
    // Home is one AU from the star, and the moon a lunar distance from Home.
    expect(distance(home as Vector3, [0, 0, 0])).toBeCloseTo(AU, -3);
    expect(distance(moon as Vector3, home as Vector3)).toBeCloseTo(
      LUNAR_DISTANCE,
      -1,
    );
  });

  it("puts the root at the origin, standing still", () => {
    const system = systemInstantAt(catalogue(SOLAR), 12_345);
    expect(system.positionByIndex.get(0)).toEqual([0, 0, 0]);
    expect(system.velocityByIndex.get(0)).toEqual([0, 0, 0]);
  });
});

describe("pointMassAccelerationAt", () => {
  it("gives GM over r squared toward the body, for a single attractor", () => {
    const facts = catalogue([{ index: 0, name: "Star", mu: STAR_MU }]);
    const system = systemInstantAt(facts, 0);
    const a = pointMassAccelerationAt(system, [AU, 0, 0]);
    expect(a[0]).toBeCloseTo(-STAR_MU / (AU * AU), 12);
    expect(a[1]).toBeCloseTo(0, 12);
    expect(a[2]).toBeCloseTo(0, 12);
  });

  it("drops exactly the excluded body's term and nothing else", () => {
    const facts = catalogue(SOLAR);
    const system = systemInstantAt(facts, 0);
    // A point a little off the moon, so the moon's own term is present, large
    // and computable rather than a division by its own zero separation.
    const moon = system.positionByIndex.get(4) as Vector3;
    const probe: Vector3 = [moon[0] + 1e6, moon[1], moon[2]];
    const all = pointMassAccelerationAt(system, probe);
    const withoutMoon = pointMassAccelerationAt(system, probe, 4);
    const moonTerm = MOON_MU / 1e12;
    // The moon pulls back along negative x from the probe, so removing its term
    // moves the sum by exactly that much in positive x.
    expect(withoutMoon[0] - all[0]).toBeCloseTo(moonTerm, 9);
    expect(withoutMoon[1] - all[1]).toBeCloseTo(0, 12);
  });
});

describe("frameInstantAt: body-centred inertial", () => {
  it("moves the origin onto the body and leaves the axes where they were", () => {
    const facts = catalogue(SOLAR);
    const system = systemInstantAt(facts, 0);
    const instant = frameInstantAt(
      facts,
      { kind: "body-centred-inertial", bodyIndex: 3 },
      0,
      system,
    );
    expect(instant).not.toBeNull();
    expect(instant?.origin).toEqual(system.positionByIndex.get(3));
    expect(instant?.basis).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(instant?.angularVelocity).toEqual([0, 0, 0]);
    expect(instant?.scaleConvention).toBe(TRAJECTORY_SCALE_CONVENTIONS.metres);
  });

  it("puts its own body at the origin of its own frame", () => {
    const facts = catalogue(SOLAR);
    const system = systemInstantAt(facts, 500);
    const instant = frameInstantAt(
      facts,
      { kind: "body-centred-inertial", bodyIndex: 4 },
      500,
      system,
    );
    const here = toFrame(
      instant as NonNullable<typeof instant>,
      system.positionByIndex.get(4) as Vector3,
    );
    expect(distance(here.position, [0, 0, 0])).toBeLessThan(1e-6);
  });
});

describe("frameInstantAt: parent-direction", () => {
  const facts = catalogue(SOLAR);

  /** The moon's frame, in which the planet is what is held on a bearing. */
  function moonFrameAt(ut: number) {
    const system = systemInstantAt(facts, ut);
    const instant = frameInstantAt(
      facts,
      { kind: "parent-direction", bodyIndex: 4 },
      ut,
      system,
    );
    return { system, instant };
  }

  it("holds the parent on a fixed bearing as the pair goes round", () => {
    const samples = [0, 200_000, 400_000, 600_000].map((ut) => {
      const { system, instant } = moonFrameAt(ut);
      return toFrame(
        instant as NonNullable<typeof instant>,
        system.positionByIndex.get(3) as Vector3,
      ).position;
    });
    // The parent sits on the first axis, a separation away, at every instant.
    // A frame that failed to rotate would swing it right around.
    for (const p of samples) {
      expect(p[0]).toBeCloseTo(LUNAR_DISTANCE, -1);
      expect(Math.abs(p[1])).toBeLessThan(1);
      expect(Math.abs(p[2])).toBeLessThan(1);
    }
  });

  it("leaves the held body nearly at rest, which is what the angular velocity term buys", () => {
    const { system, instant } = moonFrameAt(300_000);
    const held = toFrame(
      instant as NonNullable<typeof instant>,
      system.positionByIndex.get(3) as Vector3,
      system.velocityByIndex.get(3) as Vector3,
    );
    const speed = Math.hypot(...held.velocity);
    const inertialSpeed = Math.hypot(
      ...(system.velocityByIndex.get(3) as Vector3),
    );
    // Not exactly zero: the pair's own barycentre accelerates about the star,
    // so the frame is not quite the pair's two-body frame. It must nonetheless
    // be smaller than the inertial speed by orders of magnitude, which it is
    // not if the angular velocity is wrong or missing.
    expect(speed).toBeLessThan(inertialSpeed / 1000);
  });

  it("turns at the pair's own mean motion", () => {
    const { instant } = moonFrameAt(0);
    const omega = Math.hypot(
      ...((instant as NonNullable<typeof instant>).angularVelocity as Vector3),
    );
    const expected = Math.sqrt(
      (PLANET_MU + MOON_MU) /
        (LUNAR_DISTANCE * LUNAR_DISTANCE * LUNAR_DISTANCE),
    );
    // Within a part in a hundred: the third-body terms from the star and the
    // other planets are real and are not being idealised away here.
    expect(Math.abs(omega - expected) / expected).toBeLessThan(0.01);
  });

  it("refuses a frame the catalogue cannot form", () => {
    expect(
      frameInstantAt(facts, { kind: "parent-direction", bodyIndex: 0 }, 0),
    ).toBeNull();
  });
});

describe("frameInstantAt: rotating-pulsating", () => {
  /**
   * An eccentric pair, because the whole difference between the two scale
   * conventions is the separation changing along the curve. On a circular pair
   * every convention agrees and the test would prove nothing.
   */
  const ECCENTRIC: readonly BodySpec[] = [
    { index: 0, name: "Star", mu: STAR_MU },
    {
      index: 1,
      name: "Home",
      parentIndex: 0,
      mu: PLANET_MU,
      sma: AU,
      ecc: 0.35,
    },
  ];

  const facts = catalogue(ECCENTRIC);

  function pulsatingAt(ut: number) {
    const system = systemInstantAt(facts, ut);
    const instant = frameInstantAt(
      facts,
      { kind: "rotating-pulsating", bodyIndex: 1 },
      ut,
      system,
    );
    return { system, instant: instant as NonNullable<typeof instant> };
  }

  it("names its scale convention rather than leaving a coordinate to be read as a distance", () => {
    const { instant } = pulsatingAt(0);
    expect(instant.scaleConvention).toBe(
      TRAJECTORY_SCALE_CONVENTIONS.separationAtPointInstant,
    );
    expect(instant.unitLength).toBeGreaterThan(0);
  });

  it("holds BOTH bodies at fixed coordinates across an eccentric revolution", () => {
    // A year for this pair, so the samples span periapsis and apoapsis and the
    // separation really does change between them.
    const period = 2 * Math.PI * Math.sqrt(AU ** 3 / STAR_MU);
    const separations: number[] = [];
    const starX: number[] = [];
    const homeX: number[] = [];
    for (const fraction of [0, 0.17, 0.41, 0.63, 0.88]) {
      const ut = fraction * period;
      const { system, instant } = pulsatingAt(ut);
      separations.push(instant.unitLength);
      starX.push(
        toFrame(instant, system.positionByIndex.get(0) as Vector3).position[0],
      );
      homeX.push(
        toFrame(instant, system.positionByIndex.get(1) as Vector3).position[0],
      );
    }
    // The separation genuinely varies, so the constancy below is the dilatation
    // working and not an accident of a circular orbit.
    expect(Math.max(...separations) / Math.min(...separations)).toBeGreaterThan(
      1.5,
    );
    for (const x of starX) expect(x).toBeCloseTo(starX[0], 9);
    for (const x of homeX) expect(x).toBeCloseTo(homeX[0], 9);
    // And they are a unit apart, because the unit IS their separation.
    expect(homeX[0] - starX[0]).toBeCloseTo(1, 9);
  });

  it("puts the origin at the pair's mass centre, not at either body", () => {
    const { instant } = pulsatingAt(0);
    const massRatio = PLANET_MU / (STAR_MU + PLANET_MU);
    const { system } = pulsatingAt(0);
    const star = toFrame(instant, system.positionByIndex.get(0) as Vector3);
    // The heavier body sits a small fraction of the unit from the origin, on
    // the far side from the lighter one.
    expect(star.position[0]).toBeCloseTo(-massRatio, 9);
  });

  it("would not hold the bodies still under a separation fixed at one instant", () => {
    // The discriminating check for the convention this module chose. Redo the
    // transform dividing every sample by the separation at the FIRST instant,
    // and the second body walks: that is the alternative convention, and this
    // is what it costs.
    const period = 2 * Math.PI * Math.sqrt(AU ** 3 / STAR_MU);
    const first = pulsatingAt(0);
    const fixedUnit = first.instant.unitLength;
    const at = (ut: number) => {
      const { system, instant } = pulsatingAt(ut);
      const rotatedBack = toFrame(
        { ...instant, unitLength: 1, unitLengthRate: 0 },
        system.positionByIndex.get(1) as Vector3,
      ).position[0];
      return rotatedBack / fixedUnit;
    };
    expect(Math.abs(at(0.41 * period) - at(0))).toBeGreaterThan(0.2);
  });
});
