/**
 * Transfer to another body: the burn that sends a craft in orbit about one body
 * to a second body, as the single node a planner can place.
 *
 * Two cases share one solve. A moon of the craft's own body is reached by a
 * phase search: the craft's orbit and the moon's are propagated and the
 * departure instants where the moon will be on the far side of the transfer are
 * found, then the earliest good one is refined with Lambert's problem. Another
 * body that orbits the same parent as the craft's body is reached by a
 * transfer-window search: a coarse departure and arrival grid over a synodic
 * period, refined with Lambert's problem, then the ejection burn is placed on
 * the craft's orbit so the escape hyperbola leaves along the transfer's
 * departure velocity.
 *
 * Every transfer is aimed at a point beside the target rather than its centre,
 * so the encounter has the periapsis asked for instead of an impact. The
 * transfer arc is two-body about the shared parent, so an answer here is an
 * estimate that the game's own patched conics confirm or correct.
 *
 * Pure and deterministic; positions and velocities are plain metre and
 * metre-per-second triples in one inertial frame per solve.
 */
import { PerfBudget } from "@ksp-gonogo/sitrep-sdk";
import {
  type LambertResult,
  solveLambert,
  type Vec3Tuple as Vec3,
} from "./lambert";
import type { StateLike } from "./porkchop";
import { hohmannTransferTime } from "./transfer";

/**
 * Lambert solves per second across every body-transfer plan.
 *
 * A moon plan costs about fifteen hundred solves and a planet plan about two thousand, so a
 * plan fits inside a frame. The budget is there to catch a plan rebuilt on every render,
 * which burns a core for an answer that has not changed. Threshold is four full planet
 * plans per second.
 */
export const BODY_TRANSFER_SOLVE_BUDGET = new PerfBudget({
  name: "Body transfer Lambert solves/sec",
  threshold: 8000,
  windowMs: 1000,
  unit: "solves",
});

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const n = norm(a);
  return n === 0 ? [0, 0, 0] : scale(a, 1 / n);
};

const DEG = Math.PI / 180;

/**
 * The transfer angles within this many degrees of a half turn are skipped: the
 * plane through the two end points is undefined there, so the arc's normal
 * component is noise.
 */
const HALF_TURN_BAND = 1 * DEG;

/** The least departure lead, in seconds, so the node is never placed in the past by the time it is sent. */
export const DEFAULT_LEAD_SECONDS = 60;

/** A burn in the craft's own node basis. */
export interface BodyTransferBurn {
  /** Burn instant, UT seconds. */
  burnUt: number;
  /** Along the craft's velocity, m/s. */
  prograde: number;
  /** Along the craft's orbit normal, m/s. */
  normal: number;
  /** Away from the body the craft orbits, m/s. */
  radial: number;
  /** Magnitude of the burn, m/s. */
  deltaV: number;
}

export interface BodyTransferPlan extends BodyTransferBurn {
  /** Time from the burn to reaching the target, seconds. */
  transferTime: number;
  /** UT seconds the craft reaches the aim point beside the target. */
  arrivalUt: number;
  /** Periapsis altitude above the target the transfer is aimed to give, metres. */
  periapsisAltitude: number;
}

interface TargetBody {
  /** Target state relative to the body it shares with the craft's transfer arc. */
  state(ut: number): StateLike;
  /** The target's own gravitational parameter, m³/s². */
  mu: number;
  /** The target's mean radius, metres. */
  radius: number;
}

export interface MoonTransferInput {
  /** Gravitational parameter of the body the craft and the moon orbit. */
  mu: number;
  /** The craft's state about that body. */
  craft(ut: number): StateLike;
  /** The craft's orbital period, seconds. */
  craftPeriod: number;
  nowUt: number;
  /** Least time from now to the burn; defaults to {@link DEFAULT_LEAD_SECONDS}. */
  leadSeconds?: number;
  moon: TargetBody & {
    /** The moon's orbital period, seconds. */
    period: number;
    /** The moon's sphere of influence radius, metres. */
    soi: number;
  };
  /** The periapsis altitude to aim for at the moon, metres. */
  periapsisAltitude: number;
}

export interface PlanetTransferInput {
  /** Gravitational parameter of the shared parent of the craft's body and the target. */
  muParent: number;
  /** The craft's body, about the shared parent. */
  origin: {
    state(ut: number): StateLike;
    mu: number;
    soi: number;
    sma: number;
    period: number;
  };
  /** The target body, about the shared parent. */
  dest: TargetBody & { sma: number; period: number };
  /** The craft's state about its own body. */
  craft(ut: number): StateLike;
  craftPeriod: number;
  nowUt: number;
  leadSeconds?: number;
  periapsisAltitude: number;
}

const arcFrame = (hRef: Vec3) => {
  const h = unit(hRef);
  const seed: Vec3 = Math.abs(h[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const x = unit(sub(seed, scale(h, dot(seed, h))));
  const y = cross(h, x);
  return {
    toLocal: (v: Vec3): Vec3 => [dot(v, x), dot(v, y), dot(v, h)],
    toGlobal: (l: Vec3): Vec3 =>
      add(add(scale(x, l[0]), scale(y, l[1])), scale(h, l[2])),
  };
};

/**
 * Lambert's problem with the transfer direction taken about `hRef`, the
 * prograde axis of the orbit being left. The solver's own direction test reads
 * the global z axis, which is only the prograde axis for an equatorial orbit.
 */
function solveArc(
  r1: Vec3,
  r2: Vec3,
  tof: number,
  mu: number,
  hRef: Vec3,
  skipHalfTurn: boolean,
): LambertResult | null {
  const frame = arcFrame(hRef);
  const a = frame.toLocal(r1);
  const b = frame.toLocal(r2);
  if (skipHalfTurn) {
    const swept =
      (((Math.atan2(b[1], b[0]) - Math.atan2(a[1], a[0])) % (2 * Math.PI)) +
        2 * Math.PI) %
      (2 * Math.PI);
    if (Math.abs(swept - Math.PI) < HALF_TURN_BAND) return null;
  }
  const sol = solveLambert(a, b, tof, mu, true, false);
  if (!sol) return null;
  return { v1: frame.toGlobal(sol.v1), v2: frame.toGlobal(sol.v2) };
}

/**
 * The hyperbolic periapsis radius of a pass at `speed` relative to a body of
 * gravitational parameter `mu`, with `impact` the perpendicular distance between
 * the body and the incoming asymptote. `rp = -μ/v² + √((μ/v²)² + b²)`.
 */
export function flybyPeriapsisRadius(
  mu: number,
  speed: number,
  impact: number,
): number {
  const a = mu / (speed * speed);
  return -a + Math.sqrt(a * a + impact * impact);
}

/** The impact parameter of a hyperbolic pass with periapsis radius `rp`: the inverse of {@link flybyPeriapsisRadius}. */
export function flybyImpactParameter(
  mu: number,
  speed: number,
  rp: number,
): number {
  return rp * Math.sqrt(1 + (2 * mu) / (rp * speed * speed));
}

/**
 * The aim point's offset from the target centre that gives the pass
 * `periapsisRadius`: perpendicular to the relative arrival velocity, on the side
 * facing the shared parent.
 */
function aimOffset(
  target: TargetBody,
  targetState: StateLike,
  arrivalVelocity: Vec3,
  periapsisRadius: number,
): Vec3 {
  const rel = sub(arrivalVelocity, targetState.velocity);
  const speed = norm(rel);
  const vHat = unit(rel);
  const parentward = scale(targetState.position, -1);
  let side = sub(parentward, scale(vHat, dot(parentward, vHat)));
  if (norm(side) < 1e-9 * norm(parentward)) {
    side = cross(vHat, cross(targetState.position, targetState.velocity));
  }
  const b = flybyImpactParameter(target.mu, speed, periapsisRadius);
  return scale(unit(side), b);
}

/** How many times the aim point is recomputed from the arc that was aimed at the previous one; one pass brings the pass within a kilometre of the one asked for. */
const AIM_REFINEMENTS = 1;

/** Periapsis altitude of the pass an arc makes with a target when aimed at `offset` from its centre. */
function passAltitude(
  target: TargetBody,
  targetState: StateLike,
  arrivalVelocity: Vec3,
  offset: Vec3,
): number {
  const rel = sub(arrivalVelocity, targetState.velocity);
  const speed = norm(rel);
  const vHat = unit(rel);
  const impact = norm(sub(offset, scale(vHat, dot(offset, vHat))));
  return flybyPeriapsisRadius(target.mu, speed, impact) - target.radius;
}

/** A burn vector expressed in the craft's prograde, normal and radial-out basis at the burn. */
export function nodeComponents(
  craft: StateLike,
  deltaV: Vec3,
): { prograde: number; normal: number; radial: number } {
  const prograde = unit(craft.velocity);
  const normal = unit(cross(craft.position, craft.velocity));
  const radial = cross(prograde, normal);
  return {
    prograde: dot(deltaV, prograde),
    normal: dot(deltaV, normal),
    radial: dot(deltaV, radial),
  };
}

function burnFrom(
  burnUt: number,
  craft: StateLike,
  deltaVector: Vec3,
): BodyTransferBurn {
  const { prograde, normal, radial } = nodeComponents(craft, deltaVector);
  return { burnUt, prograde, normal, radial, deltaV: norm(deltaVector) };
}

/**
 * Minimise `cost` over a rectangle by a coarse grid and then successively
 * smaller grids about the best cell. `cost` returns `null` for a cell with no
 * answer.
 */
function refineGrid<T>(
  centre: [number, number],
  half: [number, number],
  lowerBound: [number, number],
  cost: (x: number, y: number) => { cost: number; result: T } | null,
  options: { rounds: number; size: number; shrink: number },
): { x: number; y: number; cost: number; result: T; solves: number } | null {
  let best: { x: number; y: number; cost: number; result: T } | null = null;
  let [cx, cy] = centre;
  let [hx, hy] = half;
  let evaluated = 0;
  for (let round = 0; round < options.rounds; round++) {
    for (let i = 0; i < options.size; i++) {
      for (let j = 0; j < options.size; j++) {
        const x = Math.max(
          lowerBound[0],
          cx - hx + (2 * hx * i) / (options.size - 1),
        );
        const y = Math.max(
          lowerBound[1],
          cy - hy + (2 * hy * j) / (options.size - 1),
        );
        evaluated += 1;
        const hit = cost(x, y);
        if (hit && (best === null || hit.cost < best.cost)) {
          best = { x, y, ...hit };
        }
      }
    }
    if (best === null) return null;
    cx = best.x;
    cy = best.y;
    hx *= options.shrink;
    hy *= options.shrink;
  }
  return best && { ...best, solves: evaluated };
}

const MOON_SCAN_SAMPLES = 6000;

/** The angle between two vectors, radians. */
function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b)))));
}

/**
 * The plan to put a craft on an encounter with a moon of the body it orbits,
 * or `null` where no transfer is found.
 *
 * Phase search: over one orbit of the moon, the departure instants at which the
 * point opposite the craft is where the moon will be after a Hohmann transfer's
 * flight time are the local minima of that angular miss. The earliest whose miss
 * is within the plane-change cost of 10 m/s of the best over the whole search is
 * the window, so a moon in the craft's plane gives the next orbit and an inclined
 * moon waits for its node.
 */
export function planMoonTransfer(
  input: MoonTransferInput,
): BodyTransferPlan | null {
  const { mu, craft, moon, nowUt } = input;
  const lead = input.leadSeconds ?? DEFAULT_LEAD_SECONDS;
  if (!(mu > 0) || !(input.craftPeriod > 0) || !(moon.period > 0)) return null;

  const start = nowUt + lead;
  const step = Math.max(
    input.craftPeriod / 24,
    moon.period / MOON_SCAN_SAMPLES,
  );
  const count = Math.ceil(moon.period / step);

  const hohmann = (ut: number) =>
    hohmannTransferTime(
      mu,
      norm(craft(ut).position),
      norm(moon.state(ut).position),
    );
  const missAt = (ut: number) =>
    angleBetween(
      scale(craft(ut).position, -1),
      moon.state(ut + hohmann(ut)).position,
    );

  const misses: number[] = [];
  for (let i = 0; i <= count + 1; i++) misses.push(missAt(start + i * step));

  /*
   * The samples are a fraction of an orbit apart, so a sampled minimum is off
   * the true one by more than the tolerance below. Each is narrowed by golden
   * section inside its two neighbours before windows are compared.
   */
  const narrowed: Array<{ ut: number; miss: number }> = [];
  for (let i = 1; i <= count; i++) {
    if (!(misses[i] < misses[i - 1] && misses[i] <= misses[i + 1])) continue;
    let lo = start + (i - 1) * step;
    let hi = start + (i + 1) * step;
    const phi = (Math.sqrt(5) - 1) / 2;
    let c = hi - phi * (hi - lo);
    let d = lo + phi * (hi - lo);
    let fc = missAt(c);
    let fd = missAt(d);
    for (let k = 0; k < 40; k++) {
      if (fc < fd) {
        hi = d;
        d = c;
        fd = fc;
        c = hi - phi * (hi - lo);
        fc = missAt(c);
      } else {
        lo = c;
        c = d;
        fc = fd;
        d = lo + phi * (hi - lo);
        fd = missAt(d);
      }
    }
    const ut = (lo + hi) / 2;
    narrowed.push({
      ut: Math.max(start, ut),
      miss: missAt(Math.max(start, ut)),
    });
  }
  if (narrowed.length === 0) return null;

  const cheapest = Math.min(...narrowed.map((w) => w.miss));
  const rStart = norm(craft(start).position);
  const departureSpeed = Math.sqrt(
    mu * (2 / rStart - 2 / (rStart + norm(moon.state(start).position))),
  );
  const tolerance = Math.asin(Math.min(1, 10 / departureSpeed));
  const chosen = narrowed.find((w) => w.miss <= cheapest + tolerance);
  if (chosen === undefined) return null;

  const centreUt = chosen.ut;
  const periapsisRadius = moon.radius + input.periapsisAltitude;
  const evaluate = (depUt: number, tof: number) => {
    const from = craft(depUt);
    const arrival = depUt + tof;
    const moonAt = moon.state(arrival);
    const hRef = cross(from.position, from.velocity);
    const toCentre = solveArc(
      from.position,
      moonAt.position,
      tof,
      mu,
      hRef,
      true,
    );
    if (!toCentre) return null;
    /*
     * Aimed once from the arc to the centre, the pass comes out at a different
     * altitude because the arc to the offset point arrives at a different
     * speed and angle. Re-aiming from each new arc converges on the asked
     * altitude.
     */
    let arc = toCentre;
    let offset = aimOffset(moon, moonAt, arc.v2, periapsisRadius);
    for (let i = 0; i <= AIM_REFINEMENTS; i++) {
      const next = solveArc(
        from.position,
        add(moonAt.position, offset),
        tof,
        mu,
        hRef,
        true,
      );
      if (!next) return null;
      arc = next;
      if (i < AIM_REFINEMENTS) {
        offset = aimOffset(moon, moonAt, arc.v2, periapsisRadius);
      }
    }
    const burnVector = sub(arc.v1, from.velocity);
    return {
      cost: norm(burnVector),
      result: { burnVector, arc, offset, moonAt, from },
    };
  };

  const flight = hohmann(centreUt);
  const found = refineGrid(
    [centreUt, flight],
    [input.craftPeriod / 2, flight * 0.25],
    [start, flight * 0.5],
    evaluate,
    { rounds: 3, size: 9, shrink: 0.35 },
  );
  BODY_TRANSFER_SOLVE_BUDGET.record(
    (found?.solves ?? 0) * (AIM_REFINEMENTS + 2),
  );
  if (!found) return null;

  const { burnVector, arc, offset, moonAt, from } = found.result;
  return {
    ...burnFrom(found.x, from, burnVector),
    transferTime: found.y,
    arrivalUt: found.x + found.y,
    periapsisAltitude: passAltitude(moon, moonAt, arc.v2, offset),
  };
}

/**
 * Seconds from periapsis to leaving a sphere of influence of radius `soi` on a
 * hyperbola of excess speed `vInf` and periapsis radius `rp` about a body of
 * gravitational parameter `mu`. Zero where the periapsis is outside the sphere.
 */
export function escapeTimeToSoi(
  mu: number,
  rp: number,
  vInf: number,
  soi: number,
): number {
  if (!(vInf > 0) || !(soi > rp)) return 0;
  const a = mu / (vInf * vInf);
  const e = 1 + rp / a;
  const f = Math.acosh((1 + soi / a) / e);
  return Math.sqrt((a * a * a) / mu) * (e * Math.sinh(f) - f);
}

/**
 * The direction and speed the craft leaves a body at, from its state about it:
 * the unit vector along the escape asymptote and the excess speed. `null` for
 * a bound orbit.
 */
export function escapeAsymptote(
  state: StateLike,
  mu: number,
): { direction: Vec3; excessSpeed: number } | null {
  const r = norm(state.position);
  const v = norm(state.velocity);
  const energy = (v * v) / 2 - mu / r;
  if (!(energy > 0)) return null;
  const h = cross(state.position, state.velocity);
  const eVec = sub(
    scale(state.position, (v * v - mu / r) / mu),
    scale(state.velocity, dot(state.position, state.velocity) / mu),
  );
  const e = norm(eVec);
  const eHat = unit(eVec);
  const hHat = unit(h);
  const cosNu = -1 / e;
  const sinNu = Math.sqrt(e * e - 1) / e;
  return {
    direction: add(scale(eHat, cosNu), scale(cross(hHat, eHat), sinNu)),
    excessSpeed: Math.sqrt(2 * energy),
  };
}

/**
 * The velocity just after a burn at `position` that puts the craft on an escape
 * hyperbola of excess speed `excessSpeed` leaving along `direction`, flown the
 * same way round as `prograde`. `null` where the position cannot reach that
 * asymptote on a prograde hyperbola.
 */
export function ejectionVelocity(
  position: Vec3,
  direction: Vec3,
  excessSpeed: number,
  mu: number,
  prograde: Vec3,
): Vec3 | null {
  const r = norm(position);
  const rHat = unit(position);
  const normal = unit(cross(rHat, direction));
  if (norm(normal) === 0 || dot(normal, prograde) <= 0) return null;
  const sweep = Math.acos(Math.max(-1, Math.min(1, dot(rHat, direction))));
  const speed = Math.sqrt(excessSpeed * excessSpeed + (2 * mu) / r);
  const swept = (gamma: number): number => {
    const h = r * speed * Math.cos(gamma);
    const e = Math.sqrt(1 + (excessSpeed * excessSpeed * h * h) / (mu * mu));
    const nu = Math.atan2(
      (h * speed * Math.sin(gamma)) / (mu * e),
      ((h * h) / (mu * r) - 1) / e,
    );
    return Math.acos(-1 / e) - nu - sweep;
  };
  const LIMIT = Math.PI / 2 - 1e-4;
  const SCAN = 360;
  let lo = Number.NaN;
  let hi = Number.NaN;
  let previous = swept(-LIMIT);
  for (let k = 1; k <= SCAN; k++) {
    const g = -LIMIT + (2 * LIMIT * k) / SCAN;
    const value = swept(g);
    if (previous === 0 || previous * value < 0) {
      lo = g - (2 * LIMIT) / SCAN;
      hi = g;
      break;
    }
    previous = value;
  }
  if (Number.isNaN(lo)) return null;
  const rising = swept(lo) < 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (swept(mid) < 0 === rising) lo = mid;
    else hi = mid;
  }
  const gamma = (lo + hi) / 2;
  const tangent = cross(normal, rHat);
  return add(
    scale(rHat, speed * Math.sin(gamma)),
    scale(tangent, speed * Math.cos(gamma)),
  );
}

const PLANET_GRID = 32;

/**
 * The plan to leave the craft's body on a transfer to another body of the same
 * parent, or `null` where no transfer is found.
 *
 * Transfer-window search: departure and flight time are gridded over one synodic
 * period and the cell with the least departure excess speed (which is the least
 * ejection burn) is refined with Lambert's problem. The ejection burn is then
 * placed on the craft's orbit within one orbit of the instant the escape
 * hyperbola must start at, whichever point on it costs least.
 */
export function planPlanetTransfer(
  input: PlanetTransferInput,
): BodyTransferPlan | null {
  const { muParent, origin, dest, craft, nowUt } = input;
  const lead = input.leadSeconds ?? DEFAULT_LEAD_SECONDS;
  const start = nowUt + lead;
  const relativeRate = Math.abs(1 / origin.period - 1 / dest.period);
  if (!(muParent > 0) || !(relativeRate > 0)) return null;
  const synodic = 1 / relativeRate;
  const flight = hohmannTransferTime(muParent, origin.sma, dest.sma);

  const originAxis = (ut: number): Vec3 => {
    const s = origin.state(ut);
    return cross(s.position, s.velocity);
  };
  const departureExcess = (depUt: number, tof: number) => {
    const from = origin.state(depUt);
    const to = dest.state(depUt + tof);
    const arc = solveArc(
      from.position,
      to.position,
      tof,
      muParent,
      originAxis(depUt),
      true,
    );
    if (!arc) return null;
    return {
      cost: norm(sub(arc.v1, from.velocity)),
      result: arc,
    };
  };

  const horizon = synodic * 1.05;
  let coarse: { depUt: number; tof: number; cost: number } | null = null;
  for (let i = 0; i < PLANET_GRID; i++) {
    const depUt = start + (horizon * i) / (PLANET_GRID - 1);
    for (let j = 0; j < PLANET_GRID; j++) {
      const tof = flight * (0.5 + j / (PLANET_GRID - 1));
      const hit = departureExcess(depUt, tof);
      if (hit && (coarse === null || hit.cost < coarse.cost)) {
        coarse = { depUt, tof, cost: hit.cost };
      }
    }
  }
  if (!coarse) return null;
  const cell = horizon / (PLANET_GRID - 1);
  const refined = refineGrid(
    [coarse.depUt, coarse.tof],
    [cell, flight / (PLANET_GRID - 1)],
    [start, flight * 0.3],
    departureExcess,
    { rounds: 3, size: 9, shrink: 0.3 },
  );
  if (!refined) return null;

  const arrivalUt = refined.x + refined.y;
  const destAtArrival = dest.state(arrivalUt);
  const periapsisRadius = dest.radius + input.periapsisAltitude;
  const offset = aimOffset(
    dest,
    destAtArrival,
    refined.result.v2,
    periapsisRadius,
  );
  const aim = add(destAtArrival.position, offset);

  /*
   * The burn instant fixes when the craft reaches the sphere's edge, which
   * fixes the departure the transfer arc must start from. The excess speed the
   * escape time is worked from is the refined cell's, which the burn's own
   * answer differs from by a few metres per second at most.
   */
  const exitFor = (burnUt: number): number =>
    burnUt +
    escapeTimeToSoi(
      origin.mu,
      norm(craft(burnUt).position),
      refined.cost,
      origin.soi,
    );
  const burnAt = (burnUt: number) => {
    const exitUt = exitFor(burnUt);
    const from = origin.state(exitUt);
    const arc = solveArc(
      from.position,
      aim,
      arrivalUt - exitUt,
      muParent,
      originAxis(exitUt),
      true,
    );
    if (!arc) return null;
    const excess = sub(arc.v1, from.velocity);
    const state = craft(burnUt);
    const velocity = ejectionVelocity(
      state.position,
      unit(excess),
      norm(excess),
      origin.mu,
      cross(state.position, state.velocity),
    );
    if (!velocity) return null;
    const burnVector = sub(velocity, state.velocity);
    return { cost: norm(burnVector), result: { burnVector, arc, state } };
  };

  const centre = Math.max(start, refined.x - (exitFor(refined.x) - refined.x));
  let placed: {
    x: number;
    cost: number;
    result: NonNullable<ReturnType<typeof burnAt>>["result"];
  } | null = null;
  let half = input.craftPeriod / 2;
  let middle = centre;
  const SAMPLES = 37;
  for (let round = 0; round < 4; round++) {
    for (let k = 0; k < SAMPLES; k++) {
      const burnUt = Math.max(
        start,
        middle - half + (2 * half * k) / (SAMPLES - 1),
      );
      const hit = burnAt(burnUt);
      if (hit && (placed === null || hit.cost < placed.cost)) {
        placed = { x: burnUt, ...hit };
      }
    }
    if (!placed) return null;
    middle = placed.x;
    half *= 0.2;
  }
  BODY_TRANSFER_SOLVE_BUDGET.record(
    PLANET_GRID * PLANET_GRID + refined.solves + 4 * SAMPLES,
  );
  if (!placed) return null;
  const { burnVector, arc, state } = placed.result;
  return {
    ...burnFrom(placed.x, state, burnVector),
    transferTime: arrivalUt - placed.x,
    arrivalUt,
    periapsisAltitude: passAltitude(dest, destAtArrival, arc.v2, offset),
  };
}

export interface ParentReturnInput {
  /** Gravitational parameter of the body the craft's body orbits. */
  muParent: number;
  /** The parent's mean radius, metres. */
  parentRadius: number;
  /** The craft's body, about the parent. */
  origin: {
    state(ut: number): StateLike;
    mu: number;
    soi: number;
    period: number;
  };
  /** The craft's state about its body. */
  craft(ut: number): StateLike;
  /** The craft's orbital period, seconds. */
  craftPeriod: number;
  nowUt: number;
  /** Least time from now to the burn; defaults to {@link DEFAULT_LEAD_SECONDS}. */
  leadSeconds?: number;
  /** The periapsis altitude to aim for at the parent, metres. */
  periapsisAltitude: number;
}

/** Periapsis radius and seconds to periapsis of the orbit a state describes about a body, or null on an escape. */
function periapsisOf(
  state: StateLike,
  mu: number,
): { radius: number; secondsTo: number } | null {
  const r = norm(state.position);
  const v2 = dot(state.velocity, state.velocity);
  const energy = v2 / 2 - mu / r;
  if (!(energy < 0)) return null;
  const h = norm(cross(state.position, state.velocity));
  const sma = -mu / (2 * energy);
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (mu * mu)));
  const E = Math.atan2(
    dot(state.position, state.velocity) / Math.sqrt(mu * sma),
    1 - r / sma,
  );
  const M = E - e * Math.sin(E);
  const n = Math.sqrt(mu / (sma * sma * sma));
  return {
    radius: sma * (1 - e),
    secondsTo: (M > 0 ? 2 * Math.PI - M : -M) / n,
  };
}

/**
 * The plan to leave the craft's body for the body it orbits, or `null` where
 * no return is found.
 *
 * The craft leaves against the body's own motion about the parent, so the
 * escape hyperbola's excess speed is what lowers the periapsis at the parent:
 * the excess speed is the one that, added to the body's velocity at the sphere
 * edge, leaves the periapsis asked for. The ejection burn is then placed on the
 * craft's orbit, over one orbit of the body, wherever it costs least; the
 * earliest burn within a small margin of the cheapest is the one planned.
 */
export function planParentReturn(
  input: ParentReturnInput,
): BodyTransferPlan | null {
  const { muParent, origin, craft, nowUt } = input;
  const start = nowUt + (input.leadSeconds ?? DEFAULT_LEAD_SECONDS);
  const target = input.parentRadius + input.periapsisAltitude;
  if (!(muParent > 0) || !(origin.soi > 0) || !(target > 0)) return null;

  const asymptote = (exitUt: number): Vec3 =>
    scale(unit(origin.state(exitUt).velocity), -1);
  const leaving = (exitUt: number, excess: number): StateLike => {
    const body = origin.state(exitUt);
    const direction = asymptote(exitUt);
    return {
      position: add(body.position, scale(direction, origin.soi)),
      velocity: add(body.velocity, scale(direction, excess)),
    };
  };
  const excessFor = (exitUt: number): number | null => {
    const peri = (excess: number): number =>
      periapsisOf(leaving(exitUt, excess), muParent)?.radius ?? Infinity;
    let lo = 0;
    let hi = norm(origin.state(exitUt).velocity) * 0.999;
    if (!(peri(lo) > target) || !(peri(hi) < target)) return null;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (peri(mid) > target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  const burnAt = (burnUt: number) => {
    const state = craft(burnUt);
    const radius = norm(state.position);
    let exitUt = burnUt;
    let excess: number | null = excessFor(burnUt);
    for (let pass = 0; pass < 2 && excess !== null; pass++) {
      exitUt = burnUt + escapeTimeToSoi(origin.mu, radius, excess, origin.soi);
      excess = excessFor(exitUt);
    }
    if (excess === null) return null;
    const velocity = ejectionVelocity(
      state.position,
      asymptote(exitUt),
      excess,
      origin.mu,
      cross(state.position, state.velocity),
    );
    if (!velocity) return null;
    const burnVector = sub(velocity, state.velocity);
    return { cost: norm(burnVector), burnVector, state, exitUt, excess };
  };

  const window = origin.period;
  const step = Math.max(input.craftPeriod / 24, window / 6000);
  const samples: { ut: number; cost: number }[] = [];
  for (let ut = start; ut <= start + window; ut += step) {
    const hit = burnAt(ut);
    if (hit) samples.push({ ut, cost: hit.cost });
  }
  if (samples.length === 0) return null;
  const cheapest = Math.min(...samples.map((s) => s.cost));
  const first = samples.find((s) => s.cost <= cheapest * 1.02 + 1);
  if (!first) return null;

  let best = burnAt(first.ut);
  let bestUt = first.ut;
  let half = step;
  for (let round = 0; round < 4 && best; round++) {
    const centre = bestUt;
    for (let k = 0; k < 9; k++) {
      const ut = Math.max(start, centre - half + (2 * half * k) / 8);
      const hit = burnAt(ut);
      if (hit && hit.cost < best.cost) {
        best = hit;
        bestUt = ut;
      }
    }
    half *= 0.3;
  }
  if (!best) return null;
  BODY_TRANSFER_SOLVE_BUDGET.record(samples.length + 36);
  const peri = periapsisOf(leaving(best.exitUt, best.excess), muParent);
  if (!peri) return null;
  const arrivalUt = best.exitUt + peri.secondsTo;
  return {
    ...burnFrom(bestUt, best.state, best.burnVector),
    transferTime: arrivalUt - bestUt,
    arrivalUt,
    periapsisAltitude: peri.radius - input.parentRadius,
  };
}
