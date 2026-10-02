import { Quality } from "../__generated__/contract";
import type { Quantityish } from "../magnitude";
import type {
  ModelledField,
  ReckonedBands,
  ReckoningDecline,
} from "../reading";
import type { TimelinePoint } from "../timeline";
import { type Value, value } from "../unit-system/value";
import {
  type OrbitElements,
  type StateVector,
  solve,
  type Vector3,
} from "./kepler";
import {
  buildElements,
  type ConicBodiesInput,
  type ConicOrbitInput,
  type ConicPendingInput,
  type ConicThrustInput,
  entryInterfaceRadius,
  isHyperbolic,
  loadedRegimeDecline,
  mag,
  underPhysics,
} from "./kepler-reckoning";

function orNaN(q: Quantityish | null | undefined): number {
  return q == null ? Number.NaN : mag(q);
}

/**
 * The powered-flight model: a craft under thrust carried forward from its last
 * observation, in the reference body's inertial frame, under point-mass gravity
 * and a steady burn.
 *
 * ## What it assumes, and where each assumption ends
 *
 * Between the last observation and the instant asked about, the burn holds:
 * the thrust the engines were making, along the direction they were last seen
 * pushing, with the mass falling at the published mass flow. Each of those
 * stops being true at a published instant, and the model withdraws there
 * rather than carrying a guess past it:
 *
 * - a command in flight reaches the craft (it may move the throttle, the
 *   attitude or the stage, and none of that is followed)
 * - the firing stage runs out of propellant (staging is not modelled)
 * - the burn carries the craft into the air or out of the body's sphere of
 *   influence
 * - the model's own uncertainty grows past one percent of the orbit's radius
 *
 * The coast that follows a cut-off is the conic's, not this model's: once
 * `vessel.propulsion` reports the engines cold, the conic carries the craft
 * and this model is never asked.
 *
 * ## What it does not know
 *
 * SAS modes and a pilot's hand. A craft holding prograde turns its thrust with
 * its velocity, and a fixed direction drifts from it; the band carries that
 * drift as the turn the burn was last measured making, and the horizon ends
 * the model when the drift is too large to stand behind.
 */

/**
 * The slice of `vessel.propulsion` a burn needs: what the cold-engine check
 * reads, plus the mass and the rate it falls at.
 *
 * @category Reckoners
 */
export interface PoweredThrustInput extends ConicThrustInput {
  totalMass: Quantityish;
  massFlow?: Quantityish | null;
}

/**
 * What a burn needs beyond the craft's own elements.
 *
 * Build one with {@link poweredFlightEvidence} from the Readings a model
 * declared, so every model of a burn reads them the same way.
 *
 * @category Reckoners
 */
export interface PoweredFlightEvidence {
  /** The engines' last stated condition, `undefined` where nothing has said. */
  readonly thrust: PoweredThrustInput | undefined;
  /** When `thrust` was observed. */
  readonly thrustAtUt: number | undefined;
  /** Tonnes of propellant left in the firing stage, `undefined` where unknown. */
  readonly stageFuel: number | undefined;
  /** The commands in flight, `undefined` where the queue has not arrived. */
  readonly pending: ConicPendingInput | undefined;
}

interface ReadingLike<Payload> {
  readonly state: string;
  readonly value?: Payload;
  readonly atUt?: Quantityish;
  readonly asOfUt?: Quantityish;
}

function heldOrObserved<Payload>(
  reading: ReadingLike<Payload>,
): Payload | undefined {
  return reading.state === "observed" || reading.state === "held"
    ? reading.value
    : undefined;
}

/**
 * {@link PoweredFlightEvidence} from the `vessel.propulsion`, `dv.stages`,
 * `vessel.structure` and `system.uplink.pending` Readings.
 *
 * The firing stage is the `dv.stages` row whose `stage` is the structure's
 * `currentStage`, the same join the delta-v budget makes.
 *
 * @category Reckoners
 */
export function poweredFlightEvidence(
  thrust: ReadingLike<PoweredThrustInput>,
  stages: ReadingLike<
    readonly ({ stage?: number | null; fuelMass?: Quantityish | null } | null)[]
  >,
  structure: ReadingLike<{ currentStage: number }>,
  pending: ReadingLike<ConicPendingInput>,
): PoweredFlightEvidence {
  const currentStage = heldOrObserved(structure)?.currentStage;
  const firing =
    currentStage === undefined
      ? undefined
      : heldOrObserved(stages)?.find((row) => row?.stage === currentStage);
  const fuel = orNaN(firing?.fuelMass);
  const observedAt =
    thrust.state === "observed"
      ? thrust.atUt
      : thrust.state === "held"
        ? thrust.asOfUt
        : undefined;
  const at = orNaN(observedAt);
  return {
    thrust: heldOrObserved(thrust),
    thrustAtUt: Number.isFinite(at) ? at : undefined,
    stageFuel: Number.isFinite(fuel) ? fuel : undefined,
    pending: heldOrObserved(pending),
  };
}

/**
 * Two-body elements from a body-centred inertial state, in the frame and
 * conventions `kepler.solve` uses, so `solve(elementsFromState(s, mu, t), t)`
 * returns `s`. Radians throughout, as `OrbitElements` is.
 *
 * Elliptical and hyperbolic alike: a burn crosses `ecc = 1` on the way to an
 * escape, and the mean anomaly is the one each regime defines. A node or an
 * apsis that does not exist (an equatorial or a circular orbit) is measured
 * from the reference direction instead, the same substitution `buildElements`
 * makes for a `null` `lan` or `argPe`.
 *
 * @category Reckoners
 */
export function elementsFromState(
  state: StateVector,
  mu: number,
  epoch: number,
): OrbitElements {
  const r = state.position;
  const v = state.velocity;
  const rMag = norm(r);
  const vMag = norm(v);
  const h = cross(r, v);
  const hMag = norm(h);
  const node: Vector3 = [-h[1], h[0], 0];
  const nodeMag = norm(node);
  const rv = dot(r, v);
  const eVec = scale(
    sub(scale(r, vMag * vMag - mu / rMag), scale(v, rv)),
    1 / mu,
  );
  const ecc = norm(eVec);
  const energy = (vMag * vMag) / 2 - mu / rMag;
  const sma = -mu / (2 * energy);
  const inc = Math.acos(clamp(h[2] / hMag));

  const equatorial = nodeMag < ANGLE_EPSILON * hMag;
  const circular = ecc < ANGLE_EPSILON;
  const lan = equatorial ? 0 : wrap(Math.atan2(node[1], node[0]));
  /*
   * The reference the periapsis is measured from: the ascending node, or the
   * inertial x axis where there is no node. Retrograde equatorial orbits turn
   * the in-plane angle round, which is what the sign of `h[2]` carries.
   */
  const inPlaneAngle = (u: Vector3): number => {
    if (!equatorial) {
      const cosAngle = dot(node, u) / (nodeMag * norm(u));
      const angle = Math.acos(clamp(cosAngle));
      return u[2] < 0 ? 2 * Math.PI - angle : angle;
    }
    const angle = Math.atan2(u[1], u[0]);
    return wrap(h[2] >= 0 ? angle : -angle);
  };
  const argPe = circular ? 0 : inPlaneAngle(eVec);
  /*
   * True anomaly from periapsis, or from the reference where there is none, so
   * that `argPe + trueAnomaly` is the argument of latitude either way.
   */
  const trueAnomaly = circular
    ? inPlaneAngle(r)
    : (() => {
        const angle = Math.acos(clamp(dot(eVec, r) / (ecc * rMag)));
        return rv < 0 ? 2 * Math.PI - angle : angle;
      })();

  return {
    sma,
    ecc,
    inc,
    lan,
    argPe,
    meanAnomalyAtEpoch: meanFromTrue(trueAnomaly, ecc),
    epoch,
    mu,
  };
}

function meanFromTrue(trueAnomaly: number, ecc: number): number {
  if (ecc < 1) {
    const eccentric =
      2 *
      Math.atan2(
        Math.sqrt(1 - ecc) * Math.sin(trueAnomaly / 2),
        Math.sqrt(1 + ecc) * Math.cos(trueAnomaly / 2),
      );
    return wrap(eccentric - ecc * Math.sin(eccentric));
  }
  const hyperbolic =
    2 *
    Math.atanh(Math.sqrt((ecc - 1) / (ecc + 1)) * Math.tan(trueAnomaly / 2));
  return ecc * Math.sinh(hyperbolic) - hyperbolic;
}

/** Below this, a node or an apsis is too ill-defined to measure from. */
const ANGLE_EPSILON = 1e-9;

function wrap(angle: number): number {
  const twoPi = 2 * Math.PI;
  const wrapped = angle % twoPi;
  return wrapped < 0 ? wrapped + twoPi : wrapped;
}

function clamp(x: number): number {
  return Math.max(-1, Math.min(1, x));
}

function dot(a: Vector3, b: Vector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm(a: Vector3): number {
  return Math.sqrt(dot(a, a));
}

function scale(a: Vector3, k: number): Vector3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

function add(a: Vector3, b: Vector3): Vector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vector3, b: Vector3): Vector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * A burn held steady in magnitude: constant thrust, the mass falling at a
 * constant rate, along a direction the caller states per instant (constant for
 * the model's own estimate, tilting for the band's).
 */
interface SteadyBurn {
  readonly direction: (ut: number) => Vector3;
  /** Kilonewtons. Over tonnes this is an acceleration in m/s² directly. */
  readonly thrust: number;
  /** Tonnes, at `massAtUt`. */
  readonly mass: number;
  readonly massAtUt: number;
  /** Tonnes per second. */
  readonly massFlow: number;
  readonly mu: number;
}

/** The longest single step the integrator takes, in seconds. */
const MAX_STEP_SECONDS = 1;

/**
 * `start` at `fromUt` carried to `toUt` under point-mass gravity and `burn`, by
 * fourth-order Runge-Kutta in steps of at most a second.
 *
 * A second is far inside every time scale the problem has: an orbit is an hour
 * long and a burn's mass changes by a fraction of a percent per second, so the
 * step error is orders below what the burn's own unknowns put in the band.
 */
function integrateBurn(
  start: StateVector,
  fromUt: number,
  toUt: number,
  burn: SteadyBurn,
): StateVector {
  const span = toUt - fromUt;
  const steps = Math.max(1, Math.ceil(Math.abs(span) / MAX_STEP_SECONDS));
  const h = span / steps;
  let r = start.position;
  let v = start.velocity;
  let t = fromUt;
  for (let i = 0; i < steps; i += 1) {
    const a1 = accelerationAt(r, t, burn);
    const r2 = add(r, scale(v, h / 2));
    const v2 = add(v, scale(a1, h / 2));
    const a2 = accelerationAt(r2, t + h / 2, burn);
    const r3 = add(r, scale(v2, h / 2));
    const v3 = add(v, scale(a2, h / 2));
    const a3 = accelerationAt(r3, t + h / 2, burn);
    const r4 = add(r, scale(v3, h));
    const v4 = add(v, scale(a3, h));
    const a4 = accelerationAt(r4, t + h, burn);
    r = add(r, scale(add(add(v, scale(add(v2, v3), 2)), v4), h / 6));
    v = add(v, scale(add(add(a1, scale(add(a2, a3), 2)), a4), h / 6));
    t += h;
  }
  return { position: r, velocity: v };
}

function accelerationAt(r: Vector3, t: number, burn: SteadyBurn): Vector3 {
  const radius = norm(r);
  const gravity = scale(r, -burn.mu / (radius * radius * radius));
  return add(gravity, scale(burn.direction(t), burn.thrust / massAt(burn, t)));
}

function massAt(burn: SteadyBurn, ut: number): number {
  return burn.mass - burn.massFlow * (ut - burn.massAtUt);
}

/**
 * Which way the engines have been pushing, read off element sets taken during
 * the burn: the later velocity, less where a coast from the earlier set would
 * have put it, is the thrust's own contribution, already in the frame the
 * conic solves in.
 *
 * Measured rather than taken from `vessel.attitude`, because the attitude is
 * the control part's orientation against the local horizon, and turning it into
 * a thrust vector needs the engines' mounting, the body's rotation and a frame
 * convention a second copy would be free to get wrong. The orbit already says
 * what the burn did.
 */
interface MeasuredThrust {
  /** Unit vector, body-centred inertial frame. */
  readonly direction: Vector3;
  /** The acceleration the burn produced over the interval, m/s². */
  readonly acceleration: number;
  /** The interval's midpoint. */
  readonly atUt: number;
  /**
   * How fast the direction was turning, radians per second, measured against
   * the interval before; zero where there was only one interval to measure.
   */
  readonly turnRate: number;
}

function thrustBetween(
  earlier: OrbitElements,
  later: OrbitElements,
): Omit<MeasuredThrust, "turnRate"> | undefined {
  const dt = later.epoch - earlier.epoch;
  if (!(dt > 0)) return undefined;
  const pushed = sub(
    solve(later, later.epoch).velocity,
    solve(earlier, later.epoch).velocity,
  );
  const size = norm(pushed);
  if (!(size > 0)) return undefined;
  return {
    direction: scale(pushed, 1 / size),
    acceleration: size / dt,
    atUt: (earlier.epoch + later.epoch) / 2,
  };
}

function measureThrust(
  sets: readonly OrbitElements[],
): MeasuredThrust | undefined {
  const n = sets.length;
  if (n < 2) return undefined;
  const last = thrustBetween(sets[n - 2], sets[n - 1]);
  if (last === undefined) return undefined;
  const before = n >= 3 ? thrustBetween(sets[n - 3], sets[n - 2]) : undefined;
  const turnRate =
    before === undefined || !(last.atUt > before.atUt)
      ? 0
      : Math.acos(clamp(dot(before.direction, last.direction))) /
        (last.atUt - before.atUt);
  return { ...last, turnRate };
}

/**
 * The smallest error the band allows for the thrust's direction, radians.
 * Chosen, not measured: a craft holding an attitude under SAS still wanders by
 * a few tenths of a degree, and a band narrower than that would claim a
 * steadiness no craft has.
 */
const DIRECTION_FLOOR = (0.5 * Math.PI) / 180;

/**
 * The smallest fractional error the band allows for the thrust's magnitude.
 * Chosen, not measured, for the same reason as {@link DIRECTION_FLOOR}.
 */
const MAGNITUDE_FLOOR = 0.01;

/**
 * How far the band may spread before the model stops, as a fraction of the
 * craft's distance from the body's centre. Chosen: one percent is a few
 * kilometres in a low orbit, past which the model is no longer telling an
 * operator where the craft is.
 */
const SPREAD_FRACTION = 0.01;

/**
 * The elements a burn moves, as `vessel.orbit` carries them on the wire.
 *
 * @category Reckoners
 */
export interface PoweredOrbitProjection {
  sma: Value<"m">;
  ecc: Value<"1">;
  inc: Value<"°">;
  lan: Value<"°">;
  argPe: Value<"°">;
  meanAnomalyAtEpoch: Value<"rad">;
  epoch: Value<"ut">;
}

/** Every path the powered model moves, in the order they are banded. */
const POWERED_PATHS = [
  "sma",
  "ecc",
  "inc",
  "lan",
  "argPe",
  "meanAnomalyAtEpoch",
  "epoch",
] as const;

/**
 * A burn carried forward: the state at any instant inside its horizon, and how
 * well that state is known.
 *
 * @category Reckoners
 */
export interface PoweredFlight {
  readonly modelled: readonly ModelledField[];
  /** Position and velocity at `ut`, body-centred inertial. */
  stateAt(ut: number): StateVector;
  /** The orbit the craft is on at `ut`, in wire units. */
  elementsAt(ut: number): PoweredOrbitProjection;
  /** One-sigma bands over every moved path, at `ut`. */
  bandsAt(ut: number): ReckonedBands;
}

/**
 * The powered model for one frame, or the reason it cannot carry the craft to
 * `reckonUt`.
 *
 * Asked only after the conic has refused the craft as under thrust, so the
 * authority and the cold-engine questions are already answered. `history` is
 * `vessel.orbit`'s own recent record, oldest first, the last entry being
 * `point`.
 *
 * Every refusal is `"under-physics"`: the craft is loaded and the orbit
 * exists, and what is withheld is carrying it forward. A consumer solving a
 * current reading at its own epoch keeps doing so.
 *
 * @category Reckoners
 */
export function poweredFlight(
  point: TimelinePoint<ConicOrbitInput>,
  history: readonly TimelinePoint<ConicOrbitInput>[],
  bodies: ConicBodiesInput | undefined,
  reckonUt: number,
  evidence: PoweredFlightEvidence,
):
  | { readonly flight: PoweredFlight }
  | { readonly declined: ReckoningDecline } {
  const orbit = point.payload;
  if (orbit == null) {
    return { declined: { reason: "input-absent", input: "@vessel.orbit" } };
  }
  const thrust = evidence.thrust;
  const thrustKn = orNaN(thrust?.currentThrust);
  const mass = orNaN(thrust?.totalMass);
  const flowKg = orNaN(thrust?.massFlow);
  const massAtUt = evidence.thrustAtUt;
  if (
    !(thrustKn > 0) ||
    !(mass > 0) ||
    !(flowKg >= 0) ||
    massAtUt === undefined
  ) {
    return {
      declined: underPhysics(
        "@vessel.propulsion",
        "the craft is under thrust and nothing says how fast the burn is drawing propellant",
      ),
    };
  }
  const regime = loadedRegimeDecline(
    point,
    orbit,
    bodies,
    reckonUt,
    evidence.pending,
  );
  if (regime !== null) return { declined: regime };

  const started = thrust?.thrustStartedUt;
  const startedUt = started == null ? Number.NEGATIVE_INFINITY : mag(started);
  const sets = history
    .filter(
      (p) =>
        p.payload != null &&
        p.meta.quality === Quality.Loaded &&
        p.validAt > startedUt,
    )
    .map((p) => buildElements(p.payload as ConicOrbitInput));
  if (sets.some((elements) => isHyperbolic(elements.ecc))) {
    return {
      declined: underPhysics(
        "@vessel.orbit",
        "hyperbolic elements: the burn cannot be measured off them",
      ),
    };
  }
  const measured = measureThrust(sets);
  if (measured === undefined) {
    return {
      declined: underPhysics(
        "@vessel.orbit",
        "the burn has not run across two samples, so nothing shows which way it pushes",
      ),
    };
  }

  const stageFuel = evidence.stageFuel;
  if (stageFuel === undefined) {
    return {
      declined: underPhysics(
        "@dv.stages",
        "nothing says how much propellant the firing stage has left",
      ),
    };
  }
  const flow = flowKg / 1000;
  if (flow > 0 && reckonUt > massAtUt + stageFuel / flow) {
    return {
      declined: underPhysics(
        "@dv.stages",
        "the firing stage runs dry before then, and what follows it is not modelled",
      ),
    };
  }

  const elements = buildElements(orbit);
  const fromUt = elements.epoch;
  const start = solve(elements, fromUt);
  const nominal: SteadyBurn = {
    direction: () => measured.direction,
    thrust: thrustKn,
    mass,
    massAtUt,
    massFlow: flow,
    mu: elements.mu,
  };
  const modelledAccel = thrustKn / massAt(nominal, measured.atUt);
  const magnitudeError = Math.max(
    MAGNITUDE_FLOOR,
    Math.abs(measured.acceleration - modelledAccel) / modelledAccel,
  );
  const burns = [nominal, ...perturbations(nominal, measured, magnitudeError)];

  const statesAt = (() => {
    let cachedUt = Number.NaN;
    let cached: StateVector[] = [];
    return (ut: number): StateVector[] => {
      if (ut !== cachedUt) {
        cached = burns.map((burn) => integrateBurn(start, fromUt, ut, burn));
        cachedUt = ut;
      }
      return cached;
    };
  })();

  const [centre, ...spread] = statesAt(reckonUt);
  const radius = norm(centre.position);
  const floor = entryInterfaceRadius(bodies, orbit.referenceBodyIndex);
  if (floor !== undefined && !(radius > floor)) {
    return {
      declined: underPhysics(
        "@system.bodies",
        "the burn carries the craft into the air before then",
      ),
    };
  }
  const soiRadius = bodies?.bodies.find(
    (b) => b.index === orbit.referenceBodyIndex,
  )?.sphereOfInfluence;
  const soi = soiRadius == null ? Number.POSITIVE_INFINITY : mag(soiRadius);
  if (radius > soi) {
    return {
      declined: underPhysics(
        "@system.bodies",
        "the burn carries the craft out of this body's sphere of influence before then",
      ),
    };
  }
  const widest = Math.max(
    ...spread.map((state) => norm(sub(state.position, centre.position))),
  );
  if (!(widest <= SPREAD_FRACTION * radius)) {
    return {
      declined: underPhysics(
        "@vessel.propulsion",
        "past where the burn model can say where the craft is to within one percent of its distance from the body",
      ),
    };
  }

  const closed = [centre, ...spread].map(
    (state) => elementsFromState(state, elements.mu, reckonUt).ecc < 1,
  );
  if (closed.some((c) => c !== closed[0])) {
    return {
      declined: underPhysics(
        "@vessel.propulsion",
        "the burn's own uncertainty spans the escape boundary, so there is no one orbit to state",
      ),
    };
  }

  const toWire = (state: StateVector, ut: number): WireNumbers =>
    wireNumbers(elementsFromState(state, elements.mu, ut));
  return {
    flight: {
      modelled: [
        { path: "", basis: "powered-integration" },
        ...POWERED_PATHS.map((path) => ({
          path,
          basis: "powered-integration" as const,
        })),
      ],
      stateAt: (ut) => statesAt(ut)[0],
      elementsAt: (ut) => projection(toWire(statesAt(ut)[0], ut)),
      bandsAt: (ut) => {
        const [mid, ...others] = statesAt(ut).map((state) => toWire(state, ut));
        return bandsAround(mid, others);
      },
    },
  };
}

/**
 * The burns the band is drawn from: the direction tilted either way about two
 * axes square to it, by the floor plus the turn the burn was last measured
 * making, and the thrust a fraction either side.
 */
function perturbations(
  nominal: SteadyBurn,
  measured: MeasuredThrust,
  magnitudeError: number,
): SteadyBurn[] {
  const axis = measured.direction;
  const seed: Vector3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const across = normalise(cross(axis, seed));
  const along = cross(axis, across);
  const tilt = (ut: number) =>
    DIRECTION_FLOOR + measured.turnRate * Math.abs(ut - measured.atUt);
  const tilted = (toward: Vector3, sign: number) => (ut: number) => {
    const angle = sign * tilt(ut);
    return add(scale(axis, Math.cos(angle)), scale(toward, Math.sin(angle)));
  };
  return [
    { ...nominal, direction: tilted(across, 1) },
    { ...nominal, direction: tilted(across, -1) },
    { ...nominal, direction: tilted(along, 1) },
    { ...nominal, direction: tilted(along, -1) },
    { ...nominal, thrust: nominal.thrust * (1 + magnitudeError) },
    { ...nominal, thrust: nominal.thrust * (1 - magnitudeError) },
  ];
}

/** Each moved path as the bare number the wire carries, in its wire unit. */
type WireNumbers = Record<(typeof POWERED_PATHS)[number], number>;

/** The wire's unit for each moved path: degrees for three angles, radians for one. */
const UNIT = {
  sma: "m",
  ecc: "1",
  inc: "°",
  lan: "°",
  argPe: "°",
  meanAnomalyAtEpoch: "rad",
  epoch: "ut",
} as const;

function wireNumbers(elements: OrbitElements): WireNumbers {
  const degrees = (radians: number) => (radians * 180) / Math.PI;
  return {
    sma: elements.sma,
    ecc: elements.ecc,
    inc: degrees(elements.inc),
    lan: degrees(elements.lan),
    argPe: degrees(elements.argPe),
    meanAnomalyAtEpoch: elements.meanAnomalyAtEpoch,
    epoch: elements.epoch,
  };
}

function projection(numbers: WireNumbers): PoweredOrbitProjection {
  return {
    sma: value(UNIT.sma, numbers.sma),
    ecc: value(UNIT.ecc, numbers.ecc),
    inc: value(UNIT.inc, numbers.inc),
    lan: value(UNIT.lan, numbers.lan),
    argPe: value(UNIT.argPe, numbers.argPe),
    meanAnomalyAtEpoch: value(
      UNIT.meanAnomalyAtEpoch,
      numbers.meanAnomalyAtEpoch,
    ),
    epoch: value(UNIT.epoch, numbers.epoch),
  };
}

/** Full turns of each angular path, for taking a difference across the wrap. */
const TURN: Partial<Record<(typeof POWERED_PATHS)[number], number>> = {
  lan: 360,
  argPe: 360,
  meanAnomalyAtEpoch: 2 * Math.PI,
};

/**
 * One-sigma bands for every moved path: the nominal value, and the furthest
 * any perturbed burn lands from it on each side.
 *
 * `sigma1` and not `bound`: the perturbations are an estimate of the burn's
 * error, not a cap on it.
 */
function bandsAround(
  mid: WireNumbers,
  others: readonly WireNumbers[],
): ReckonedBands {
  const bands: Record<string, ReckonedBands[string]> = {};
  for (const path of POWERED_PATHS) {
    const centre = mid[path];
    const turn = TURN[path];
    let below = 0;
    let above = 0;
    for (const other of others) {
      let delta = other[path] - centre;
      if (turn !== undefined) {
        delta = ((((delta + turn / 2) % turn) + turn) % turn) - turn / 2;
      }
      below = Math.min(below, delta);
      above = Math.max(above, delta);
    }
    const unit = UNIT[path];
    bands[path] = {
      value: value(unit, centre),
      lo: value(unit, centre + below),
      hi: value(unit, centre + above),
      kind: "sigma1",
    };
  }
  return bands;
}

function normalise(a: Vector3): Vector3 {
  return scale(a, 1 / norm(a));
}
