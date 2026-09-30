import { describe, expect, it } from "vitest";
import { type OrbitPatch, Quality } from "../__generated__/contract";
import { type WireOf, wrapTypePayload } from "../wrap-units";
import {
  findImpactPoint,
  type ImpactPointInput,
  predictImpactPoint,
} from "./impact-point";
import {
  PropagationHorizonKindLike as Reach,
  TrajectoryKindLike as Shape,
} from "./kepler";
import type {
  SystemBodiesPayload,
  VesselFlightPayload,
  VesselOrbitPayload,
} from "./wire-payloads";

/*
 * A synthetic body chosen so gravity is a round g = mu/(radius+altitudeAsl)²:
 * mu = 8e10, radius = 200_000, altitudeAsl = 0, so g = 2.0 m/s². Falling at
 * 10 m/s from 100 m above terrain, the closed-form fall time is ~6.18 s and
 * the search is bounded to ~9.27 s ahead.
 */
const RADIUS = 200_000;
const ROTATION = 21_600;
const BODIES: SystemBodiesPayload = {
  bodies: [
    {
      name: "Testmun",
      index: 3,
      parentIndex: 0,
      radius: RADIUS,
      rotationPeriod: ROTATION,
      orbit: null,
    },
  ],
};

const ANALYTIC = { kind: Reach.Unbounded, trajectoryKind: Shape.Analytic };

type WireOrbit = WireOf<VesselOrbitPayload>;
type WirePatch = WireOf<OrbitPatch>;

const ORBIT: WireOrbit = {
  referenceBodyIndex: 3,
  sma: 250_000,
  ecc: 0,
  inc: 0,
  lan: null,
  argPe: null,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 8e10,
  horizon: ANALYTIC,
};

const DESCENT: WireOf<VesselFlightPayload> = {
  latitude: 0,
  longitude: 10,
  altitudeAsl: 0,
  altitudeTerrain: 100,
  verticalSpeed: -10,
  surfaceSpeed: 20,
  orbitalSpeed: 20,
  gForce: 0,
  dynamicPressureKPa: 0,
  mach: 0,
  atmDensity: 0,
};

/*
 * A short (12 s) synthetic period so the apoapsis-to-surface crossing, ~4.7 s
 * after the view instant, fits inside the ~9.27 s search. `period` is a plain
 * input to the walk, not derived from sma and mu, so it is fine that it is
 * physically inconsistent with the orbit's own mu: these cases exercise the
 * walk, not the dynamics.
 */
function syntheticPatch(overrides: Partial<WirePatch> = {}): WirePatch {
  return {
    sma: 250_000,
    ecc: 0.6,
    inc: 0,
    lan: 0,
    argPe: 0,
    // Mean anomaly π is apoapsis (r = 400_000, above the 200_000 radius); the walk crosses the surface on the way down toward periapsis (r = 100_000).
    meanAnomalyAtEpoch: Math.PI,
    epoch: 0,
    period: 12,
    startUt: 0,
    endUt: 100,
    patchStartTransition: 0,
    patchEndTransition: 1,
    peA: 0,
    apA: 0,
    semiLatusRectum: 0,
    semiMinorAxis: 0,
    referenceBody: "Kerbin",
    closestEncounterBody: null,
    ...overrides,
  };
}

function input(
  orbit: Partial<WireOrbit> = {},
  opts: {
    flight?: Partial<WireOf<VesselFlightPayload>>;
    bodies?: SystemBodiesPayload | null;
    viewUt?: number;
  } = {},
): ImpactPointInput {
  const wire = { ...ORBIT, patches: [syntheticPatch()], ...orbit };
  return {
    orbit: wrapTypePayload<ImpactPointInput["orbit"]>(
      "VesselOrbit",
      wire as WireOf<ImpactPointInput["orbit"]>,
    ),
    flight: wrapTypePayload<VesselFlightPayload>("VesselFlight", {
      ...DESCENT,
      ...opts.flight,
    }),
    bodies: opts.bodies === undefined ? BODIES : opts.bodies,
    viewUt: opts.viewUt ?? 0,
  };
}

/**
 * Elements whose own conic is on its way down through the surface threshold
 * (`RADIUS - 100`), `metresAbove` it at the view instant, with the patch that
 * describes the same conic. Descending at roughly 400 m/s there, so 50 m above
 * crosses a fraction of a second out and 5 km above crosses past the ~9.27 s
 * fall bound.
 */
function descending(metresAbove: number, tilt = { inc: 0, lan: 0, argPe: 0 }) {
  const sma = 250_000;
  const ecc = 0.6;
  const r = RADIUS - 100 + metresAbove;
  const nu =
    2 * Math.PI - Math.acos((sma * (1 - ecc * ecc)) / r / ecc - 1 / ecc);
  const eccentric =
    2 *
    Math.atan2(
      Math.sqrt(1 - ecc) * Math.sin(nu / 2),
      Math.sqrt(1 + ecc) * Math.cos(nu / 2),
    );
  const mean = eccentric - ecc * Math.sin(eccentric);
  const meanAnomalyAtEpoch =
    ((mean % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return {
    sma,
    ecc,
    meanAnomalyAtEpoch,
    ...tilt,
    patches: [
      syntheticPatch({
        sma,
        ecc,
        meanAnomalyAtEpoch,
        ...tilt,
        period: 2 * Math.PI * Math.sqrt(sma ** 3 / 8e10),
      }),
    ],
  };
}

/** An integrating provider's horizon, 20 s out, so the sampled conic is dense. */
const INTEGRATED_UNTIL = {
  kind: Reach.Until,
  untilUt: 20,
  trajectoryKind: Shape.Integrated,
};

describe("predictImpactPoint: the descent it is solved for", () => {
  it("answers a point when the patch chain actually crosses the surface", () => {
    const impact = predictImpactPoint(input());
    expect(impact).not.toBeNull();
    expect(Number.isFinite(impact?.lat)).toBe(true);
    expect(Number.isFinite(impact?.lon)).toBe(true);
  });

  it("answers none when vessel.orbit carries no patches yet", () => {
    expect(predictImpactPoint(input({ patches: [] }))).toBeNull();
  });

  /*
   * The body the WIRE names, which is not a body any stock table carries. The
   * patch's own `referenceBody` string is deliberately the same one, so
   * nothing here can fall back to a stock name by accident.
   */
  it("answers for a body only the stream knows about", () => {
    const impact = predictImpactPoint(
      input({ patches: [syntheticPatch({ referenceBody: "Testmun" })] }),
    );
    expect(impact).not.toBeNull();
    expect(Number.isFinite(impact?.lat)).toBe(true);
  });

  /*
   * Neither source has one: the stream omits the field and the patch's body is
   * not a stock name the fallback table carries.
   */
  it("answers none for a body whose rotation period nothing reports", () => {
    const impact = predictImpactPoint(
      input(
        { patches: [syntheticPatch({ referenceBody: "Not-A-Real-Body" })] },
        {
          bodies: {
            bodies: [
              {
                name: "Testmun",
                index: 3,
                parentIndex: 0,
                radius: RADIUS,
                orbit: null,
              },
            ],
          },
        },
      ),
    );
    expect(impact).toBeNull();
  });

  it("answers none when not descending", () => {
    expect(
      predictImpactPoint(input({}, { flight: { verticalSpeed: 10 } })),
    ).toBeNull();
  });

  it("answers none without the body's radius", () => {
    expect(predictImpactPoint(input({}, { bodies: null }))).toBeNull();
  });

  it("answers none for an orbit whose own meta says it is on rails", () => {
    expect(
      predictImpactPoint(
        input({ meta: { source: "vessel:a", quality: Quality.OnRails } }),
      ),
    ).toBeNull();
  });

  it("answers the same point for an orbit whose own meta says it is loaded", () => {
    const loaded = predictImpactPoint(
      input({ meta: { source: "vessel:a", quality: Quality.Loaded } }),
    );
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(predictImpactPoint(input()));
  });
});

describe("predictImpactPoint: a conic answer", () => {
  it("is the vacuum-ballistic patch walk when the horizon does not bite", () => {
    const g = 8e10 / RADIUS ** 2;
    const timeToImpact = (-10 + Math.sqrt(100 + 2 * g * 100)) / g;
    const horizonSec = timeToImpact * 1.5;
    const walked = findImpactPoint(
      [input().orbit.patches?.[0] as OrbitPatch],
      "Kerbin",
      RADIUS,
      ROTATION,
      { ut: 0, lat: 0, lon: 10 },
      horizonSec,
      Math.max(1, horizonSec / 60),
    );
    expect(walked).not.toBeNull();

    expect(predictImpactPoint(input())).toEqual(walked);
    // A bound past the crossing (~4.7 s) changes nothing.
    expect(
      predictImpactPoint(
        input({
          horizon: {
            kind: Reach.Until,
            untilUt: 9,
            trajectoryKind: Shape.Analytic,
          },
        }),
      ),
    ).toEqual(walked);
  });

  it("answers none for an impact past the provider's horizon", () => {
    // Reachable at the view instant, so the answer IS a conic, but the crossing is ~4.7 s out and the provider vouches for 4.
    expect(
      predictImpactPoint(
        input({
          horizon: {
            kind: Reach.Until,
            untilUt: 4,
            trajectoryKind: Shape.Analytic,
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("predictImpactPoint: an arc answer", () => {
  it("crosses the surface where the patch walk over the same conic does", () => {
    const orbit = descending(50);
    const walked = predictImpactPoint(input({ ...orbit, horizon: ANALYTIC }));
    const sampled = predictImpactPoint(
      input({ ...orbit, horizon: INTEGRATED_UNTIL }),
    );
    expect(walked).not.toBeNull();
    // To a tenth of a degree: the walk steps a second at a time and the arc interpolates between samples, so the two agree to tens of metres, and a wrong lift misses by tens of degrees.
    expect(sampled?.lat).toBeCloseTo(walked?.lat ?? Number.NaN, 1);
    expect(sampled?.lon).toBeCloseTo(walked?.lon ?? Number.NaN, 1);
  });

  it("lifts the sampled points back through the elements they were drawn in", () => {
    // Inclined elements, so the orbit's own plane is nowhere near the inertial one: the two answers agree only if the lift undoes the rotation.
    const orbit = descending(50, { inc: 30, lan: 40, argPe: 50 });
    const walked = predictImpactPoint(input({ ...orbit, horizon: ANALYTIC }));
    const sampled = predictImpactPoint(
      input({ ...orbit, horizon: INTEGRATED_UNTIL }),
    );
    expect(walked).not.toBeNull();
    // To a tenth of a degree: the walk steps a second at a time and the arc interpolates between samples, so the two agree to tens of metres, and a wrong lift misses by tens of degrees.
    expect(sampled?.lat).toBeCloseTo(walked?.lat ?? Number.NaN, 1);
    expect(sampled?.lon).toBeCloseTo(walked?.lon ?? Number.NaN, 1);
  });

  it("answers none for a crossing past the fall bound", () => {
    expect(
      predictImpactPoint(
        input({ ...descending(5_000), horizon: INTEGRATED_UNTIL }),
      ),
    ).toBeNull();
    // The control: the same conic nearer the surface crosses inside it.
    expect(
      predictImpactPoint(
        input({ ...descending(2_000), horizon: INTEGRATED_UNTIL }),
      ),
    ).not.toBeNull();
  });
});

describe("predictImpactPoint: a withheld answer", () => {
  it("answers none when the provider states no horizon", () => {
    expect(predictImpactPoint(input({ horizon: undefined }))).toBeNull();
  });

  it("answers none when the provider states reach but not shape", () => {
    expect(
      predictImpactPoint(input({ horizon: { kind: Reach.Unbounded } })),
    ).toBeNull();
  });

  it("answers none once the view instant is past the horizon", () => {
    expect(
      predictImpactPoint(
        input(
          {
            horizon: {
              kind: Reach.Until,
              untilUt: 1,
              trajectoryKind: Shape.Analytic,
            },
          },
          { viewUt: 2 },
        ),
      ),
    ).toBeNull();
  });
});
