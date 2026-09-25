import { describe, expect, it } from "vitest";
import { Quality } from "../__generated__/contract";
import { type WireOf, wrapTypePayload } from "../wrap-units";
import {
  findImpactPoint,
  type ImpactPointInput,
  predictImpactPoint,
} from "./impact-point";
import {
  PropagationHorizonKindLike as Reach,
  rotateInertialToPerifocal,
  TrajectoryKindLike as Shape,
} from "./kepler";
import { mapOrbitPatch, type OrbitPatchWirePayload } from "./orbit-patches";
import { TrajectoryFrameKindLike as Frame } from "./orbit-trajectory";
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
const INTEGRATED = { kind: Reach.Unbounded, trajectoryKind: Shape.Integrated };

type WireOrbit = WireOf<VesselOrbitPayload> & {
  arc?: unknown;
  arcRefusal?: number;
};
type WirePatch = WireOf<OrbitPatchWirePayload>;

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
    // Mean anomaly π is apoapsis (r = 400_000, above the 200_000 radius); the
    // walk crosses the surface on the way down toward periapsis (r = 100_000).
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
 * A straight-line fall along the inertial direction at `latDeg` latitude and
 * zero inertial longitude, from 200 m above the radius at 100 m/s: the point
 * crosses `RADIUS - 100` (the surface threshold) at t = 3 s.
 */
function fallingArc(
  latDeg: number,
  frame: { kind: number; centreBodyIndex?: number | null } = {
    kind: Frame.BodyCentredInertial,
    centreBodyIndex: 3,
  },
  fromUt = 0,
) {
  const lat = (latDeg * Math.PI) / 180;
  const points = Array.from({ length: 21 }, (_, i) => {
    const ut = fromUt + i;
    const r = RADIUS + 200 - 100 * (ut - fromUt);
    return { ut, x: r * Math.cos(lat), y: 0, z: r * Math.sin(lat) };
  });
  return {
    frame: { ...frame, lengthsPulsate: false },
    points,
    fromUt,
    toUt: fromUt + 20,
    sourcePointCount: points.length,
    derivation: 2,
  };
}

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
      [mapOrbitPatch(input().orbit.patches?.[0] as OrbitPatchWirePayload)],
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
    // Reachable at the view instant, so the answer IS a conic, but the
    // crossing is ~4.7 s out and the provider vouches for 4.
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
  it("is the surface crossing on the provider's own points", () => {
    const impact = predictImpactPoint(
      input({ horizon: INTEGRATED, arc: fallingArc(20) }),
    );
    // Crossing at t = 3 s. The craft's inertial longitude at the view instant
    // is 0 and it is observed at 10°, so the crossing is 10° less the 3 s of
    // surface rotation under it.
    expect(impact?.lat).toBeCloseTo(20, 9);
    expect(impact?.lon).toBeCloseTo(10 - (360 / ROTATION) * 3, 9);
  });

  it("lifts perifocal points back through the elements they were rotated by", () => {
    // Inclined elements, so the perifocal frame is nowhere near the inertial
    // one: the inertial answer comes back only if the lift undoes the rotation.
    const tilted = { inc: 30, lan: 40, argPe: 50 };
    const rad = (d: number) => (d * Math.PI) / 180;
    const inertial = fallingArc(20);
    const perifocal = {
      ...inertial,
      frame: { kind: Frame.Perifocal, lengthsPulsate: false },
      points: inertial.points.map((p) => {
        const [x, y, z] = rotateInertialToPerifocal(
          [p.x, p.y, p.z],
          rad(tilted.inc),
          rad(tilted.lan),
          rad(tilted.argPe),
        );
        return { ut: p.ut, x, y, z };
      }),
    };
    const impact = predictImpactPoint(
      input({ ...tilted, horizon: INTEGRATED, arc: perifocal }),
    );
    expect(impact?.lat).toBeCloseTo(20, 9);
    expect(impact?.lon).toBeCloseTo(10 - (360 / ROTATION) * 3, 9);
  });

  it("answers none for an arc whose crossing is past the fall bound", () => {
    const raised = (metres: number) => {
      const arc = fallingArc(0);
      return {
        ...arc,
        points: arc.points.map((p) => ({ ...p, x: p.x + metres })),
      };
    };
    // Crossing at t = 9.5 s, inside the sample that straddles the ~9.27 s bound.
    expect(
      predictImpactPoint(input({ horizon: INTEGRATED, arc: raised(650) })),
    ).toBeNull();
    // Crossing at t = 11 s, a whole sample past it.
    expect(
      predictImpactPoint(input({ horizon: INTEGRATED, arc: raised(800) })),
    ).toBeNull();
    // The control: the same arc raised less crosses at t = 9 s, inside it.
    expect(
      predictImpactPoint(input({ horizon: INTEGRATED, arc: raised(600) })),
    ).not.toBeNull();
  });

  it("answers none for an arc in a frame that cannot yield a latitude and longitude", () => {
    expect(
      predictImpactPoint(
        input({
          horizon: INTEGRATED,
          arc: fallingArc(0, {
            kind: Frame.BodyCentredRotating,
            centreBodyIndex: 3,
          }),
        }),
      ),
    ).toBeNull();
  });

  it("answers none for an arc centred on another body", () => {
    expect(
      predictImpactPoint(
        input({
          horizon: INTEGRATED,
          arc: fallingArc(0, {
            kind: Frame.BodyCentredInertial,
            centreBodyIndex: 7,
          }),
        }),
      ),
    ).toBeNull();
  });

  it("answers none for an arc that does not reach back to the view instant", () => {
    expect(
      predictImpactPoint(
        input({ horizon: INTEGRATED, arc: fallingArc(0, undefined, 1) }),
      ),
    ).toBeNull();
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
