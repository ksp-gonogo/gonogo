/**
 * Libration points as places: the five positions a body PAIR holds still, and
 * how far off one of them a craft is.
 *
 * ## The pair is the frame, and that is the whole shape of this module
 *
 * A libration point is a fixed location only in a frame co-rotating with two
 * bodies. All five of one pair's points stand still in that pair's frame at the
 * same time, so five markers in one frame is exactly right, and Kerbin-Mun's
 * points and Kerbol-Kerbin's points cannot both stand still at once. Naming the
 * pair therefore IS naming the frame: there is one choice here, not two, and
 * every function below takes the secondary body and derives the rest.
 *
 * ## Why the pulsating frame rather than a plain rotating one
 *
 * The frame this module works in is {@link ReadFrameChoice} `rotating-pulsating`
 * (reference-frame.ts): origin at the two sides' combined mass centre, first
 * axis on the bearing between them, and every coordinate divided by their
 * separation. That last part is what makes the points constants rather than
 * merely slow: for a pair on an eccentric orbit the equilibrium positions are
 * fixed in the NON-DIMENSIONALISED rotating frame and are not fixed in a
 * metre-scaled one, because the whole configuration breathes with the
 * separation. Divide by the separation and the breathing goes out of the
 * coordinates; keep metres and the five points walk in and out once per orbit.
 *
 * That is also why a metre-scaled diagram cannot host these markers, whatever
 * else it does well: it would draw them moving, which is the one thing a
 * libration point is defined not to do.
 *
 * ## What the numbers ARE, stated rather than implied
 *
 * The five positions are the restricted three-body problem's equilibria for the
 * pair's mass ratio: L4 and L5 in closed form, L1 to L3 as the roots of the
 * collinear equilibrium equation, solved numerically. The mass ratio comes from
 * the two SIDES' summed gravitational parameters, the same sides the frame is
 * built on, so the points and the frame cannot disagree about where the origin
 * is.
 *
 * Declared fidelity: **restricted three-body equilibria for the pair, in the
 * pair's own pulsating frame.** The other thirty-odd bodies move the true
 * equilibria slightly and are not solved for here; they DO enter through the
 * frame, whose angular velocity is summed over the whole catalogue as point
 * masses. A craft is never at a mathematical equilibrium anyway, which is what
 * the station-keeping offset below is for.
 */

import { PerfBudget } from "../perf/PerfBudget";
import type { CelestialBody, CelestialFacts } from "./celestial-facts";
import type { Vector3 } from "./kepler";
import {
  type FrameInstant,
  frameInstantAt,
  frameSides,
  fromFrame,
  type ReadFrameChoice,
  type SystemInstant,
  systemInstantAt,
  toFrame,
} from "./reference-frame";

export const LAGRANGE_POINT_NAMES = ["L1", "L2", "L3", "L4", "L5"] as const;

export type LagrangePointName = (typeof LAGRANGE_POINT_NAMES)[number];

/**
 * Why a pair has no five points, or that it has them.
 *
 * <b>Zero means something TRUE.</b> `NotAttempted` is "no pair was named", which
 * is the state a widget is in before an operator picks one and the state a
 * catalogue that has not arrived leaves it in. It is deliberately NOT a
 * catch-all: an `Unspecified = 0` reading as "nothing was refused" is how a
 * feature that never ran once looked healthy on every frame it published.
 *
 * The three real refusals are separated by what an operator would DO about
 * them, which is the only distinction worth carrying: a body the catalogue does
 * not have is a different situation from a body that cannot have a pair at all,
 * and both are different from a pair that is real and whose states this instant
 * do not determine.
 */
export const LIBRATION_REFUSALS = {
  /** No pair was named, so no points were sought. Not a fault and not a complaint. */
  NotAttempted: 0,
  /** A pair was named and the catalogue does not carry that body this frame. */
  PairUnknown: 1,
  /** The named body is the root star. It orbits nothing, so there is no pair to turn about. */
  RootHasNoPair: 2,
  /**
   * The pair is real and this instant does not determine its points: a parent
   * chain the solver cannot walk, a side with no gravitational parameter on the
   * wire, or a separation too degenerate to give the frame a bearing. The
   * answer's own sentence says which.
   */
  NotComputable: 3,
  /** The five points were computed. Only ever beside a present set of five. */
  NotRefused: 4,
} as const;

export type LibrationRefusal =
  (typeof LIBRATION_REFUSALS)[keyof typeof LIBRATION_REFUSALS];

/** The pair, as far as it could be identified. */
export interface LibrationPair {
  /** The body the pair is named FOR, and the one whose system is the secondary side. */
  secondaryIndex: number;
  secondaryName: string | null;
  /** Its parent, whose system is the primary side. Null when the parent could not be identified. */
  primaryIndex: number | null;
  primaryName: string | null;
}

export interface LibrationPoint {
  name: LagrangePointName;
  /**
   * The point in the pair's rotating-pulsating frame: multiples of the pair's
   * separation, and CONSTANT for as long as the pair's mass ratio is.
   */
  frame: Vector3;
  /** The same point in root-centred inertial metres at the answer's `ut`. */
  inertial: Vector3;
}

export interface LibrationAnswer {
  refusal: LibrationRefusal;
  /** Which pair, as far as it is known. Null only when no body was named at all. */
  pair: LibrationPair | null;
  /**
   * Why, in words, for a reader. Empty on `NotRefused` and on `NotAttempted`:
   * one has nothing to explain and the other has nothing to explain yet.
   */
  because: string;
  /** L1 to L5 in that order. Empty unless `NotRefused`. */
  points: readonly LibrationPoint[];
  /**
   * The secondary side's share of the pair's mass, `m2 / (m1 + m2)`, which is
   * the only parameter the five positions depend on. `NaN` unless `NotRefused`.
   */
  massRatio: number;
  /** The frame the points stand still in. Null unless `NotRefused`. */
  frame: FrameInstant | null;
  /** The frame that was SOUGHT, whether or not it was formed. */
  frameChoice: ReadFrameChoice;
  ut: number;
}

/**
 * Libration point sets computed, per second.
 *
 * One per second per widget in steady state, because the set only changes when
 * the view instant does and a caller buckets the instant. The regression is a
 * widget recomputing on every render instead: at display rate that is sixty a
 * second from one widget, a hundred and twenty once the development build's
 * double render is counted, and either of those crosses this while eight
 * widgets drawing normally do not come near it.
 */
const LIBRATION_BUDGET = new PerfBudget({
  name: "Libration point sets computed/sec",
  threshold: 100,
  windowMs: 1000,
  unit: "sets",
});

/** How close to a point counts as holding station, as a multiple of the pair's separation. */
export const LIBRATION_ON_STATION_UNITS = 0.02;

/** Beyond this multiple of the separation a craft is not station-keeping on the point at all. */
export const LIBRATION_DRIFTING_UNITS = 0.15;

/**
 * What a craft's offset from the nearest point MEANS. Semantic and never a
 * colour: the widget owns the palette, so one theme change reaches every
 * reading of this at once.
 *
 * `elsewhere` is not a fault. A craft in low orbit is nearest to some libration
 * point in the arithmetic sense and is not stationkeeping on it, and dressing
 * that as an alarm would be an alarm about nothing.
 */
export type LibrationStationKeeping = "on-station" | "drifting" | "elsewhere";

export interface LibrationOffset {
  nearest: LagrangePointName;
  /** The craft in the pair's frame: multiples of the separation. */
  vesselFrame: Vector3;
  /** Straight-line distance from the craft to that point at the answer's `ut`, metres. */
  distanceMetres: number;
  /** The same distance as a multiple of the pair's separation. */
  distanceUnits: number;
  keeping: LibrationStationKeeping;
}

const NO_PAIR_CHOICE = (
  bodyIndex: number | null | undefined,
): ReadFrameChoice => ({
  kind: "rotating-pulsating",
  bodyIndex: bodyIndex ?? null,
});

function refused(
  refusal: LibrationRefusal,
  because: string,
  pair: LibrationPair | null,
  bodyIndex: number | null | undefined,
  ut: number,
): LibrationAnswer {
  return {
    refusal,
    pair,
    because,
    points: [],
    massRatio: Number.NaN,
    frame: null,
    frameChoice: NO_PAIR_CHOICE(bodyIndex),
    ut,
  };
}

function parentOf(
  facts: CelestialFacts,
  body: CelestialBody,
): CelestialBody | null {
  if (body.referenceBody === null) return null;
  const parent = facts.bodies.find((b) => b.name === body.referenceBody);
  // A body listed as its own parent is the root saying so, not a cycle.
  return parent === undefined || parent.index === body.index ? null : parent;
}

function sideMass(system: SystemInstant, side: readonly number[]): number {
  let mass = 0;
  for (const index of side) mass += system.muByIndex.get(index) ?? 0;
  return mass;
}

/**
 * `x` where the collinear equilibrium condition vanishes, in frame units along
 * the first axis, with the combined mass centre at the origin.
 *
 * The primary sits at `-mu` and the secondary at `1 - mu`. The condition is the
 * rotating frame's radial balance: the centrifugal term `x` against each body's
 * pull. It diverges at either body, which is what gives each of the three roots
 * a bracket with a sign change across it.
 */
function collinearResidual(x: number, mu: number): number {
  const toPrimary = x + mu;
  const toSecondary = x - 1 + mu;
  const dp = Math.abs(toPrimary);
  const ds = Math.abs(toSecondary);
  return (
    x -
    ((1 - mu) * toPrimary) / (dp * dp * dp) -
    (mu * toSecondary) / (ds * ds * ds)
  );
}

/** Bisection, or null when the bracket does not straddle a root. */
function bisectCollinear(
  mu: number,
  lower: number,
  upper: number,
): number | null {
  let lo = lower;
  let hi = upper;
  let fLo = collinearResidual(lo, mu);
  const fHi = collinearResidual(hi, mu);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
  if (fLo === 0) return lo;
  if (fHi === 0) return hi;
  if (fLo > 0 === fHi > 0) return null;
  // A hundred halvings of a bracket at most three units wide is well past
  // double precision, and costs nothing at five points a second.
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const fMid = collinearResidual(mid, mu);
    if (!Number.isFinite(fMid)) return null;
    if (fMid > 0 === fLo > 0) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/** How close to a body the collinear brackets stop. Small enough not to exclude a root, large enough that the divergent term stays finite. */
const COLLINEAR_BRACKET_GAP = 1e-9;

/**
 * The five equilibria for a mass ratio, in the pair's frame, or null when the
 * collinear roots do not bracket.
 *
 * Exported because the mass ratio is the whole of the input: a test can pin the
 * five positions against the ratio alone, with no catalogue, no instant and no
 * frame in the way.
 */
export function librationPositionsFor(
  massRatio: number,
): readonly { name: LagrangePointName; frame: Vector3 }[] | null {
  const mu = massRatio;
  if (!(mu > 0 && mu < 1)) return null;
  const primaryX = -mu;
  const secondaryX = 1 - mu;
  const l1 = bisectCollinear(
    mu,
    primaryX + COLLINEAR_BRACKET_GAP,
    secondaryX - COLLINEAR_BRACKET_GAP,
  );
  const l2 = bisectCollinear(
    mu,
    secondaryX + COLLINEAR_BRACKET_GAP,
    secondaryX + 1,
  );
  const l3 = bisectCollinear(
    mu,
    primaryX - 1,
    primaryX - COLLINEAR_BRACKET_GAP,
  );
  if (l1 === null || l2 === null || l3 === null) return null;
  // L4 and L5 need no solving: each forms an equilateral triangle with the two
  // bodies, so in these units they sit half a separation along the axis from the
  // primary and root-three-over-two off it.
  const triangleX = 0.5 - mu;
  const triangleY = Math.sqrt(3) / 2;
  return [
    { name: "L1", frame: [l1, 0, 0] },
    { name: "L2", frame: [l2, 0, 0] },
    { name: "L3", frame: [l3, 0, 0] },
    { name: "L4", frame: [triangleX, triangleY, 0] },
    { name: "L5", frame: [triangleX, -triangleY, 0] },
  ];
}

/**
 * The five libration points of the pair the given body belongs to, at `ut`.
 *
 * `secondaryIndex` names the body, and its parent completes the pair: one
 * argument, because the pair is one choice. Pass the `system` when the caller
 * already solved the whole catalogue at this instant, which is the ordinary case
 * for a widget also placing a craft.
 */
export function lagrangePointsAt(
  facts: CelestialFacts | undefined,
  secondaryIndex: number | null | undefined,
  ut: number,
  system?: SystemInstant,
): LibrationAnswer {
  if (facts === undefined || secondaryIndex == null || !Number.isFinite(ut)) {
    return refused(
      LIBRATION_REFUSALS.NotAttempted,
      "",
      null,
      secondaryIndex,
      ut,
    );
  }
  const secondary = facts.bodies.find((b) => b.index === secondaryIndex);
  if (secondary === undefined) {
    return refused(
      LIBRATION_REFUSALS.PairUnknown,
      `The catalogue does not carry body ${secondaryIndex}, so there is no pair to name.`,
      null,
      secondaryIndex,
      ut,
    );
  }
  const pairOf = (primary: CelestialBody | null): LibrationPair => ({
    secondaryIndex: secondary.index,
    secondaryName: secondary.name,
    primaryIndex: primary?.index ?? null,
    primaryName: primary?.name ?? null,
  });
  if (secondary.referenceBody === null) {
    return refused(
      LIBRATION_REFUSALS.RootHasNoPair,
      `${secondary.name ?? "That body"} orbits nothing, so it is not half of a pair and has no libration points.`,
      pairOf(null),
      secondaryIndex,
      ut,
    );
  }
  const primary = parentOf(facts, secondary);
  if (primary === null) {
    return refused(
      LIBRATION_REFUSALS.PairUnknown,
      `${secondary.name ?? "That body"} is listed as orbiting ${secondary.referenceBody}, which the catalogue does not carry.`,
      pairOf(null),
      secondaryIndex,
      ut,
    );
  }

  const pair = pairOf(primary);
  const choice = NO_PAIR_CHOICE(secondaryIndex);
  const sides = frameSides(facts, choice);
  if (sides === null) {
    return refused(
      LIBRATION_REFUSALS.NotComputable,
      `The ${pair.primaryName}-${pair.secondaryName} pair has no two sides the catalogue can name this frame.`,
      pair,
      secondaryIndex,
      ut,
    );
  }
  LIBRATION_BUDGET.record();
  const state = system ?? systemInstantAt(facts, ut);
  const frame = frameInstantAt(facts, choice, ut, state);
  if (frame === null) {
    return refused(
      LIBRATION_REFUSALS.NotComputable,
      `The ${pair.primaryName}-${pair.secondaryName} frame could not be formed at this instant: the pair's states give it no bearing or no mass.`,
      pair,
      secondaryIndex,
      ut,
    );
  }
  const primaryMass = sideMass(state, sides.primary);
  const secondaryMass = sideMass(state, sides.secondary);
  const total = primaryMass + secondaryMass;
  const massRatio = total > 0 ? secondaryMass / total : Number.NaN;
  const positions = librationPositionsFor(massRatio);
  if (positions === null) {
    return refused(
      LIBRATION_REFUSALS.NotComputable,
      `The ${pair.primaryName}-${pair.secondaryName} mass ratio is not a ratio the equilibrium equation has roots for; at least one side carries no gravitational parameter on the wire.`,
      pair,
      secondaryIndex,
      ut,
    );
  }

  return {
    refusal: LIBRATION_REFUSALS.NotRefused,
    pair,
    because: "",
    points: positions.map(({ name, frame: inFrame }) => ({
      name,
      frame: inFrame,
      inertial: fromFrame(frame, inFrame),
    })),
    massRatio,
    frame,
    frameChoice: choice,
    ut,
  };
}

/**
 * Which point a craft is nearest, how far off it is, and what that means.
 *
 * The metre distance is taken between the two INERTIAL positions rather than by
 * multiplying a frame coordinate by the separation, because a pulsating frame's
 * coordinate is a ratio and the two operations only agree for points at the same
 * instant. Taking it in metres needs no convention at all.
 */
export function librationOffsetOf(
  answer: LibrationAnswer,
  vesselInertial: Vector3 | null | undefined,
): LibrationOffset | null {
  if (answer.refusal !== LIBRATION_REFUSALS.NotRefused) return null;
  if (answer.frame === null || vesselInertial == null) return null;
  if (!vesselInertial.every((c) => Number.isFinite(c))) return null;
  const unitLength = answer.frame.unitLength;
  if (!(unitLength > 0) || !Number.isFinite(unitLength)) return null;

  let nearest: LibrationPoint | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const point of answer.points) {
    const dx = vesselInertial[0] - point.inertial[0];
    const dy = vesselInertial[1] - point.inertial[1];
    const dz = vesselInertial[2] - point.inertial[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!Number.isFinite(distance)) continue;
    if (distance < best) {
      best = distance;
      nearest = point;
    }
  }
  if (nearest === null || !Number.isFinite(best)) return null;

  const distanceUnits = best / unitLength;
  const keeping: LibrationStationKeeping =
    distanceUnits <= LIBRATION_ON_STATION_UNITS
      ? "on-station"
      : distanceUnits <= LIBRATION_DRIFTING_UNITS
        ? "drifting"
        : "elsewhere";
  return {
    nearest: nearest.name,
    vesselFrame: toFrame(answer.frame, vesselInertial).position,
    distanceMetres: best,
    distanceUnits,
    keeping,
  };
}

/**
 * Every pair the catalogue can form, secondary body first in wire order.
 *
 * The list a pair control offers, and the only place the rule lives: a pair
 * needs a body with a parent and a gravitational parameter on both sides, so a
 * body the arithmetic would refuse never reaches the control. Offering it and
 * then refusing it is how a control teaches an operator to distrust it.
 */
export function librationPairsOf(
  facts: CelestialFacts | undefined,
): readonly LibrationPair[] {
  if (facts === undefined) return [];
  const out: LibrationPair[] = [];
  for (const body of facts.bodies) {
    if (body.referenceBody === null) continue;
    const primary = parentOf(facts, body);
    if (primary === null) continue;
    if (!(Number(body.gravParameter) > 0)) continue;
    if (!(Number(primary.gravParameter) > 0)) continue;
    out.push({
      secondaryIndex: body.index,
      secondaryName: body.name,
      primaryIndex: primary.index,
      primaryName: primary.name,
    });
  }
  return out;
}

/** How a pair is named where an operator meets it: primary first, the way every libration pair is written. */
export function librationPairLabel(pair: LibrationPair | null): string {
  if (pair === null) return "no pair";
  const primary = pair.primaryName ?? "?";
  const secondary = pair.secondaryName ?? "?";
  return `${primary}-${secondary}`;
}
