import { describe, expect, it } from "vitest";
import { Quality } from "../__generated__/contract";
import { makeMeta } from "../testing/stub-transport";
import type { TimelinePoint } from "../timeline";
import { value } from "../unit-system/value";
import {
  type OrbitElements,
  PropagationHorizonKindLike as Reach,
  TrajectoryKindLike as Shape,
  type StateVector,
  solve,
  type Vector3,
} from "./kepler";
import type { ConicBodiesInput, ConicOrbitInput } from "./kepler-reckoning";
import {
  elementsFromState,
  type PoweredFlightEvidence,
  type PoweredThrustInput,
  poweredFlight,
} from "./powered-reckoning";

/**
 * The burn model against a burn integrated here, independently of it: a
 * prograde-held burn from a circular orbit, sampled into element sets the way
 * the wire carries them, then asked forward.
 */

const MU = 3.5316e12;
const RADIUS = 800_000;
const THRUST_KN = 60;
const MASS_T = 10;
const FLOW_KG = 20;
const BODIES: ConicBodiesInput = {
  bodies: [
    {
      index: 1,
      radius: value("m", 600_000),
      sphereOfInfluence: value("m", 84_000_000),
    },
  ],
};

const START: OrbitElements = {
  sma: RADIUS,
  ecc: 0,
  inc: 0.2,
  lan: 1,
  argPe: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: MU,
};

/** The burn's fixed inertial direction: prograde at ignition. */
const DIRECTION: Vector3 = (() => {
  const v = solve(START, 0).velocity;
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
})();

/** The truth: a tenth-of-a-second RK4, deliberately not the model's own step. */
function truthAt(ut: number): StateVector {
  let r = solve(START, 0).position;
  let v = solve(START, 0).velocity;
  const h = 0.1;
  const accel = (pos: Vector3, t: number): Vector3 => {
    const d = Math.hypot(pos[0], pos[1], pos[2]);
    const k = THRUST_KN / (MASS_T - (FLOW_KG / 1000) * t);
    return [
      (-MU * pos[0]) / d ** 3 + k * DIRECTION[0],
      (-MU * pos[1]) / d ** 3 + k * DIRECTION[1],
      (-MU * pos[2]) / d ** 3 + k * DIRECTION[2],
    ];
  };
  const plus = (a: Vector3, b: Vector3, s: number): Vector3 => [
    a[0] + b[0] * s,
    a[1] + b[1] * s,
    a[2] + b[2] * s,
  ];
  for (let t = 0; t < ut - 1e-9; t += h) {
    const a1 = accel(r, t);
    const r2 = plus(r, v, h / 2);
    const v2 = plus(v, a1, h / 2);
    const a2 = accel(r2, t + h / 2);
    const r3 = plus(r, v2, h / 2);
    const v3 = plus(v, a2, h / 2);
    const a3 = accel(r3, t + h / 2);
    const r4 = plus(r, v3, h);
    const v4 = plus(v, a3, h);
    const a4 = accel(r4, t + h);
    r = rk4Step(r, v, v2, v3, v4, h);
    v = rk4Step(v, a1, a2, a3, a4, h);
  }
  return { position: r, velocity: v };
}

/** One fourth-order Runge-Kutta update of `x` from the four slopes. */
function rk4Step(
  x: Vector3,
  k1: Vector3,
  k2: Vector3,
  k3: Vector3,
  k4: Vector3,
  h: number,
): Vector3 {
  const at = (i: 0 | 1 | 2) =>
    x[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  return [at(0), at(1), at(2)];
}

const degrees = (radians: number) => (radians * 180) / Math.PI;

function sampleAt(ut: number): TimelinePoint<ConicOrbitInput> {
  const e = elementsFromState(truthAt(ut), MU, ut);
  return {
    validAt: ut,
    epoch: 0,
    meta: makeMeta({ validAt: ut, deliveredAt: ut, quality: Quality.Loaded }),
    payload: {
      referenceBodyIndex: 1,
      sma: value("m", e.sma),
      ecc: value("1", e.ecc),
      inc: value("°", degrees(e.inc)),
      lan: value("°", degrees(e.lan)),
      argPe: value("°", degrees(e.argPe)),
      meanAnomalyAtEpoch: value("rad", e.meanAnomalyAtEpoch),
      epoch: value("ut", ut),
      mu: value("m³/s²", MU),
      horizon: { kind: Reach.Unbounded, trajectoryKind: Shape.Analytic },
    },
  };
}

const HISTORY = [sampleAt(1), sampleAt(2), sampleAt(3)];
const LAST = HISTORY[HISTORY.length - 1];

/** The engines as `vessel.propulsion` reports them at the last sample. */
const FIRING: PoweredThrustInput = {
  currentThrust: value("kN", THRUST_KN),
  totalMass: value("t", MASS_T - (FLOW_KG / 1000) * 3),
  massFlow: value("kg/s", FLOW_KG),
  thrustStartedUt: value("ut", 0),
  lastThrustEndUt: null,
};

function evidence(
  overrides: Partial<PoweredFlightEvidence> = {},
): PoweredFlightEvidence {
  return {
    thrust: FIRING,
    thrustAtUt: 3,
    stageFuel: 4,
    pending: undefined,
    ...overrides,
  };
}

function reasonOf(answer: ReturnType<typeof poweredFlight>) {
  return "declined" in answer
    ? { reason: answer.declined.reason, input: answer.declined.input }
    : "carried";
}

describe("elementsFromState", () => {
  it("returns the elements kepler.solve reached the state from", () => {
    const cases: OrbitElements[] = [
      START,
      { ...START, ecc: 0.6, argPe: 2, meanAnomalyAtEpoch: 4 },
      { ...START, inc: Math.PI / 2, lan: 4, ecc: 0.1 },
      { ...START, inc: 0, lan: 0, ecc: 0.3, argPe: 5 },
      { ...START, inc: Math.PI, ecc: 0.2, argPe: 1 },
    ];
    for (const elements of cases) {
      const back = elementsFromState(solve(elements, 50), MU, 50);
      for (const t of [50, 900]) {
        const a = solve(elements, t).position;
        const b = solve(back, t).position;
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(
          0.01,
        );
      }
    }
  });
});

describe("poweredFlight", () => {
  it("carries a steady burn to within a metre of where it goes", () => {
    const at = 33;
    const answer = poweredFlight(LAST, HISTORY, BODIES, at, evidence());
    if (!("flight" in answer)) throw new Error(JSON.stringify(answer));
    const modelled = answer.flight.stateAt(at).position;
    const truth = truthAt(at).position;
    expect(
      Math.hypot(
        modelled[0] - truth[0],
        modelled[1] - truth[1],
        modelled[2] - truth[2],
      ),
    ).toBeLessThan(1);
    expect(answer.flight.modelled.map((m) => m.basis)).toEqual(
      Array(8).fill("powered-integration"),
    );
  });

  it("moves every element, and its band holds the true orbit", () => {
    const at = 33;
    const answer = poweredFlight(LAST, HISTORY, BODIES, at, evidence());
    if (!("flight" in answer)) throw new Error(JSON.stringify(answer));
    const truth = elementsFromState(truthAt(at), MU, at);
    const sma = answer.flight.elementsAt(at).sma.magnitude;
    expect(sma).toBeGreaterThan(RADIUS + 10_000);
    expect(sma).toBeCloseTo(truth.sma, -1);
    const band = answer.flight.bandsAt(at).sma;
    expect(band?.kind).toBe("sigma1");
    expect(band?.lo.magnitude).toBeLessThan(truth.sma);
    expect(band?.hi.magnitude).toBeGreaterThan(truth.sma);
  });

  it("widens its band the further it carries the burn", () => {
    const answer = poweredFlight(LAST, HISTORY, BODIES, 60, evidence());
    if (!("flight" in answer)) throw new Error(JSON.stringify(answer));
    const width = (at: number) => {
      const band = answer.flight.bandsAt(at).sma;
      return (band?.hi.magnitude ?? 0) - (band?.lo.magnitude ?? 0);
    };
    expect(width(60)).toBeGreaterThan(width(10));
  });

  it("withdraws at each published end of the burn, as under physics", () => {
    expect({
      noFlow: reasonOf(
        poweredFlight(
          LAST,
          HISTORY,
          BODIES,
          20,
          evidence({
            thrust: { ...FIRING, massFlow: null },
          }),
        ),
      ),
      oneSample: reasonOf(poweredFlight(LAST, [LAST], BODIES, 20, evidence())),
      stageUnknown: reasonOf(
        poweredFlight(
          LAST,
          HISTORY,
          BODIES,
          20,
          evidence({ stageFuel: undefined }),
        ),
      ),
      stageDry: reasonOf(
        poweredFlight(LAST, HISTORY, BODIES, 20, evidence({ stageFuel: 0.2 })),
      ),
      commandInGap: reasonOf(
        poweredFlight(
          LAST,
          HISTORY,
          BODIES,
          20,
          evidence({
            pending: {
              pending: [
                {
                  dispatchedAt: value("ut", 5),
                  oneWaySeconds: value("s", 5),
                },
              ],
            },
          }),
        ),
      ),
      pastItsOwnUncertainty: reasonOf(
        poweredFlight(
          LAST,
          HISTORY,
          BODIES,
          120,
          evidence({
            thrust: { ...FIRING, currentThrust: value("kN", 30) },
          }),
        ),
      ),
    }).toEqual({
      noFlow: { reason: "under-physics", input: "@vessel.propulsion" },
      oneSample: { reason: "under-physics", input: "@vessel.orbit" },
      stageUnknown: { reason: "under-physics", input: "@dv.stages" },
      stageDry: { reason: "under-physics", input: "@dv.stages" },
      commandInGap: {
        reason: "under-physics",
        input: "@system.uplink.pending",
      },
      pastItsOwnUncertainty: {
        reason: "under-physics",
        input: "@vessel.propulsion",
      },
    });
  });

  /*
   * The burn above reaches escape about two minutes in. Near that instant some
   * of the band's burns close the orbit and some do not, and an sma band would
   * then run from a large positive number through infinity to a negative one.
   */
  it("never states an orbit band that straddles the escape boundary", () => {
    let withdrew = 0;
    for (let at = 110; at <= 160; at += 0.5) {
      const answer = poweredFlight(
        LAST,
        HISTORY,
        BODIES,
        at,
        evidence({ stageFuel: 9 }),
      );
      if ("declined" in answer) {
        withdrew += 1;
        continue;
      }
      const band = answer.flight.bandsAt(at).sma;
      expect(Math.sign(band?.lo.magnitude ?? 0)).toBe(
        Math.sign(band?.hi.magnitude ?? 0),
      );
    }
    expect(withdrew).toBeGreaterThan(0);
  });
});
