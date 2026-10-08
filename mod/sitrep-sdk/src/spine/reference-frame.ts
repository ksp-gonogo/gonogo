/**
 * Read frames: the arithmetic that lets one widget draw in a different
 * reference frame from the widget beside it.
 *
 * ## Two different things live here, and only one of them is a transform
 *
 * `toFrame` and `fromFrame` are a coordinate change and nothing else: arithmetic
 * over points the caller already holds, which is what makes a read frame free of
 * the hazard the in-game plotting frame carries. That one is singular and
 * synced, so a second screen picking it moves what the player sees; this one
 * cannot move anything at all. The boundary is the TRAJECTORY, not the
 * transform: a read frame inherits the fidelity of whatever propagated the
 * curve rather than conferring any of its own.
 *
 * {@link systemInstantAt} is NOT that. It EVALUATES the catalogue's elements at
 * an arbitrary UT, which is a claim about where a body will be and not a
 * restatement of one. The claim is sound under stock, where a body rides a fixed
 * conic about a fixed parent and its place at a UT is a published fact computed
 * on demand; it is bounded under an n-body install, where the elements are the
 * conic tangent to an integrated path and the elected provider says how far it
 * stays worth having. See that function for both halves. Nothing here asks the
 * n-body mod for anything directly: the bound arrives on the wire beside the
 * elements it bounds, stated by whoever propagates them.
 *
 * ## The frames, and what each needs
 *
 * | Frame | Origin | Orientation from | Velocities additionally need |
 * |---|---|---|---|
 * | body-centred inertial | one body | nothing, the axes are the catalogue's | nothing |
 * | parent-direction | the selected body | the bearing to its parent | the pair's relative acceleration |
 * | rotating-pulsating | the pair's mass centre | the bearing between two SETS | the same, plus the separation's rate |
 *
 * The accelerations are the part that looks expensive and is not. A frame's
 * angular velocity depends on the relative acceleration only through the
 * component orthogonal to the plane the separation and its rate span, and a
 * two-body acceleration is parallel to the separation, so it contributes
 * nothing there at all. What is missing under a two-body shortcut is the pull of
 * the OTHER bodies, and restoring it is a point-mass sum over the catalogue.
 * The oblateness of the bodies, which is the part that would need a gravity
 * field we do not have, moves the angular velocity by about four parts in a
 * hundred million for the Earth-Moon pair, and is not computed here.
 *
 * ## The scale convention, which had to be chosen rather than copied
 *
 * A pulsating frame divides every coordinate by the separation of its two mass
 * centres, so its length unit moves with time and there is no one right way to
 * quote a number in it. The n-body mod itself uses two at once, scaling
 * positions at the render instant and velocities at their own, and says in its
 * own source that the result is a convenience rather than a physical quantity.
 *
 * **This module divides each point by the separation at THAT POINT'S OWN
 * instant**, and says so on every curve it produces
 * ({@link TRAJECTORY_SCALE_CONVENTIONS}). That is the convention under which the
 * two bodies sit at fixed coordinates for the whole length of the curve, which
 * is the only reason to draw in this frame: under the alternative, fixing the
 * separation at the view instant, the secondary body drifts along the curve and
 * the Lagrange points drift with it. The cost is that a coordinate is a
 * multiple of the current separation rather than a distance, which is what
 * `lengthsPulsate` exists to say.
 */

import { PropagationHorizonKind } from "../__generated__/contract";
import { PerfBudget } from "../perf/PerfBudget";
import type { CelestialBody, CelestialFacts } from "./celestial-facts";
import { type OrbitElements, solve, type Vec3Tuple } from "./kepler";

/**
 * The reference frames a widget may draw in:
 *
 * - `follow-control-frame`: whatever frame the player has selected in game,
 *   where a mod reports one. With no such mod, there is none to follow
 * - `body-centred-inertial`: centred on a body, not rotating
 * - `parent-direction`: centred on a body, turning to keep its parent in one
 *   direction
 * - `rotating-pulsating`: turning with a body and its parent, and scaled so the
 *   distance between them stays 1
 *
 * @category Frames of reference
 */
export const READ_FRAME_KINDS = [
  "follow-control-frame",
  "body-centred-inertial",
  "parent-direction",
  "rotating-pulsating",
] as const;

/**
 * One of {@link READ_FRAME_KINDS}.
 *
 * @category Frames of reference
 */
export type ReadFrameKind = (typeof READ_FRAME_KINDS)[number];

/**
 * A frame a widget draws in: a {@link ReadFrameKind} and the body it is built
 * on. The centred frames are centred on that body; the rotating frames turn
 * with that body and its parent, as the game's own frame selector does.
 *
 * @category Frames of reference
 */
export interface ReadFrameChoice {
  /** Which kind of frame. */
  kind: ReadFrameKind;
  /** The selected body's `system.bodies` index. Unused by `follow-control-frame`. */
  bodyIndex?: number | null;
}

/**
 * What a coordinate in a frame is measured in.
 *
 * @category Frames of reference
 */
export const TRAJECTORY_SCALE_CONVENTIONS = {
  /** Metres. Every frame whose length unit stands still. */
  metres: "metres",
  /** A multiple of the distance between the frame's two bodies at the point's own instant. Not a distance. */
  separationAtPointInstant: "separation-at-point-instant",
} as const;

/**
 * One of {@link TRAJECTORY_SCALE_CONVENTIONS}.
 *
 * @category Frames of reference
 */
export type TrajectoryScaleConvention =
  (typeof TRAJECTORY_SCALE_CONVENTIONS)[keyof typeof TRAJECTORY_SCALE_CONVENTIONS];

/**
 * A frame's state at one instant: where it is, how it is turned and how it is
 * scaled. Compute it once with {@link frameInstantAt} and pass it to
 * {@link toFrame} and {@link fromFrame} for every point at that instant.
 * Positions and velocities are relative to the root body, in metres and
 * metres per second, not turning.
 *
 * @category Frames of reference
 */
export interface FrameInstant {
  /** The instant, as a UT. */
  ut: number;
  /** Root-centred inertial position of the frame's origin, metres. */
  origin: Vec3Tuple;
  /** That origin's velocity, m/s. */
  originVelocity: Vec3Tuple;
  /**
   * The frame's axes as rows, each a unit vector in root-centred inertial
   * components: the bearing to the secondary, the in-plane perpendicular ahead
   * of it, and the pair's orbit normal. Identity for a non-rotating frame.
   */
  basis: readonly [Vec3Tuple, Vec3Tuple, Vec3Tuple];
  /** The frame's angular velocity in inertial components, rad/s. Zero for a non-rotating frame. */
  angularVelocity: Vec3Tuple;
  /** What a rotating-pulsating frame divides lengths by, metres: the distance between its bodies. Exactly 1 for every other frame. */
  unitLength: number;
  /** How fast `unitLength` changes, m/s. Exactly 0 for every other frame. */
  unitLengthRate: number;
  /** What the frame's coordinates are measured in. */
  scaleConvention: TrajectoryScaleConvention;
}

/**
 * A point and, when the caller had one, its velocity, both in a frame's coordinates.
 *
 * @category Frames of reference
 */
export interface FrameCoordinates {
  /** The position, in the frame's coordinates. */
  position: Vec3Tuple;
  /** The velocity, in the frame's coordinates. Meaningful only when a velocity was given. */
  velocity: Vec3Tuple;
}

/**
 * Frame states computed, per second.
 *
 * Four widgets in four frames refreshing at 1 Hz over a 256-point curve is
 * about 1,000/sec, since a curve needs one state per point instant. The
 * regression this exists to catch is a widget recomputing on every render
 * rather than on new data, which at 60 Hz is ~60,000/sec: the threshold sits
 * above steady state by the usual margin and an order of magnitude below the
 * regression, so it cannot read green through the thing it is watching for.
 *
 * Recorded on the computation itself and never on a cache hit. A budget that
 * counts hits measures the cache, not the work, and reads green through
 * exactly the regression it was installed for.
 */
const FRAME_INSTANT_BUDGET = new PerfBudget({
  name: "Reference frame states computed/sec",
  threshold: 20_000,
  windowMs: 1000,
  unit: "instants",
});

/** How far up a parent chain the walk will go before giving up. Star, planet, moon, submoon is four. */
const MAX_PARENT_DEPTH = 8;

const ZERO: Vec3Tuple = [0, 0, 0];
const IDENTITY: readonly [Vec3Tuple, Vec3Tuple, Vec3Tuple] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function sub(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vec3Tuple, k: number): Vec3Tuple {
  return [a[0] * k, a[1] * k, a[2] * k];
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm(a: Vec3Tuple): number {
  return Math.sqrt(dot(a, a));
}

/** `v / |v|`, or null when `v` has no direction to give. */
function unit(v: Vec3Tuple): Vec3Tuple | null {
  const n = norm(v);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  return scale(v, 1 / n);
}

/**
 * The derivative of `v / |v|` given `v` and `v̇`: the part of `v̇` that turns
 * the direction, with the part that only lengthens it removed.
 */
function normalisedRate(v: Vec3Tuple, vDot: Vec3Tuple): Vec3Tuple | null {
  const n = norm(v);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  const n2 = n * n;
  return scale(sub(scale(vDot, n2), scale(v, dot(v, vDot))), 1 / (n2 * n));
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function finite(x: number | null | undefined): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * A body's elements against its parent, in the radians-and-metres shape the
 * solver wants, or null when the catalogue has not filled them.
 *
 * The root star has no elements and is not a failure: it is the origin of
 * everything here, and null is how it says so.
 */
function elementsOf(
  body: CelestialBody,
  parent: CelestialBody | null,
): OrbitElements | null {
  if (parent === null) return null;
  if (
    !finite(body.semiMajorAxis) ||
    !finite(body.eccentricity) ||
    !finite(body.meanAnomalyAtEpoch) ||
    !finite(body.epoch) ||
    !finite(parent.gravParameter)
  ) {
    return null;
  }
  return {
    sma: body.semiMajorAxis,
    ecc: body.eccentricity,
    inc: degToRad(body.inclination ?? 0),
    lan: degToRad(body.lan ?? 0),
    argPe: degToRad(body.argumentOfPeriapsis ?? 0),
    meanAnomalyAtEpoch: body.meanAnomalyAtEpoch,
    epoch: body.epoch,
    mu: parent.gravParameter,
  };
}

/**
 * Why a body has no position at an instant: its propagation provider says its
 * orbit holds only until `untilUt`, and the instant is later.
 *
 * @category Frames of reference
 */
export interface BodyWithdrawal {
  /**
   * The body whose horizon ran out: this body, or one it orbits. A moon is
   * withdrawn when its planet is, even if the moon's own orbit holds.
   */
  bodyIndex: number;
  /** The last UT that body's provider vouched for. */
  untilUt: number;
}

/**
 * Every body's position and velocity relative to the root body at one
 * instant, as {@link systemInstantAt} returns it, in metres and m/s.
 *
 * @category Frames of reference
 */
export interface SystemInstant {
  /** The instant, as a UT. */
  ut: number;
  /** Each body's position, by body index. A body missing here has none at this instant. */
  positionByIndex: ReadonlyMap<number, Vec3Tuple>;
  /** Each body's velocity, by body index. */
  velocityByIndex: ReadonlyMap<number, Vec3Tuple>;
  /** Each body's gravitational parameter, m³/s², by body index. */
  muByIndex: ReadonlyMap<number, number>;
  /**
   * The bodies left out of `positionByIndex` because this instant is past their
   * horizon, with which body's horizon ran out. Always empty in stock KSP.
   * Check it before showing a missing body as missing data.
   */
  withdrawnByIndex: ReadonlyMap<number, BodyWithdrawal>;
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

/**
 * The last UT a body's elements answer for, or null when its provider claimed
 * no limit.
 *
 * Only a stated `Until` bounds anything. `Unspecified` does NOT withdraw the
 * body, and that is a deliberate reading of a genuinely awkward arm: it is what
 * a host sends when its horizon resolver FAULTED, and refusing every body on a
 * fault empties the system diagram rather than making it honest. A caller that
 * wants to know the shape has `body.horizon.trajectoryKind` beside this and can
 * refuse a conic renderer on it; what this function will not do is invent a
 * number nobody stated, in either direction.
 */
function horizonUt(body: CelestialBody): number | null {
  const horizon = body.horizon;
  if (horizon.kind !== PropagationHorizonKind.Until) return null;
  return finite(horizon.untilUt) ? horizon.untilUt : null;
}

/**
 * Returns every body's position and velocity relative to the root body at
 * `ut`, computed for that instant from the catalogue's orbits. Call it for
 * the instant you are drawing; nothing needs advancing each frame.
 *
 * In stock KSP every body is on a fixed orbit, so every body is returned for
 * any UT. In an n-body game a body past the horizon its provider states is
 * left out and listed in `withdrawnByIndex`, and so is any body orbiting it.
 * A body whose parent chain cannot be solved is left out too, never placed at
 * the origin.
 *
 * @category Frames of reference
 */
export function systemInstantAt(
  facts: CelestialFacts,
  ut: number,
): SystemInstant {
  const positionByIndex = new Map<number, Vec3Tuple>();
  const velocityByIndex = new Map<number, Vec3Tuple>();
  const muByIndex = new Map<number, number>();
  const withdrawnByIndex = new Map<number, BodyWithdrawal>();
  if (!Number.isFinite(ut)) {
    return {
      ut,
      positionByIndex,
      velocityByIndex,
      muByIndex,
      withdrawnByIndex,
    };
  }
  FRAME_INSTANT_BUDGET.record();

  for (const body of facts.bodies) {
    if (finite(body.gravParameter))
      muByIndex.set(body.index, body.gravParameter);
  }

  const solveChain = (body: CelestialBody): boolean => {
    if (positionByIndex.has(body.index)) return true;
    const chain: CelestialBody[] = [];
    let cursor: CelestialBody | null = body;
    let depth = 0;
    while (cursor !== null && depth <= MAX_PARENT_DEPTH) {
      if (positionByIndex.has(cursor.index)) break;
      chain.push(cursor);
      cursor = parentOf(facts, cursor);
      depth++;
    }
    if (cursor !== null && !positionByIndex.has(cursor.index)) {
      // The chain ran past its depth bound, which means the catalogue's parent
      // links form a loop. Refuse the whole chain rather than anchor it at
      // whichever body the walk happened to stop on.
      return false;
    }
    const anchorPosition =
      cursor === null ? ZERO : positionByIndex.get(cursor.index);
    const anchorVelocity =
      cursor === null ? ZERO : velocityByIndex.get(cursor.index);
    if (anchorPosition === undefined || anchorVelocity === undefined) {
      return false;
    }
    let position: Vec3Tuple = anchorPosition;
    let velocity: Vec3Tuple = anchorVelocity;
    for (let i = chain.length - 1; i >= 0; i--) {
      const link = chain[i];

      // Asked past what this body's provider vouched for. Refuse from here
      // down: everything below hangs off a place nobody will state, so a moon
      // whose own elements are unbounded is withdrawn naming the planet that
      // ran out rather than itself.
      const until = horizonUt(link);
      if (until !== null && ut > until) {
        for (let j = i; j >= 0; j--) {
          withdrawnByIndex.set(chain[j].index, {
            bodyIndex: link.index,
            untilUt: until,
          });
        }
        return false;
      }

      const parent = parentOf(facts, link);
      const elements = elementsOf(link, parent);
      if (elements === null) {
        if (parent === null) {
          // The root. It is the origin, and everything below it hangs off this.
          positionByIndex.set(link.index, position);
          velocityByIndex.set(link.index, velocity);
          continue;
        }
        return false;
      }
      if (!(elements.ecc >= 0 && elements.ecc < 1)) return false;
      const state = solve(elements, ut);
      position = add(position, state.position);
      velocity = add(velocity, state.velocity);
      positionByIndex.set(link.index, position);
      velocityByIndex.set(link.index, velocity);
    }
    return true;
  };

  for (const body of facts.bodies) solveChain(body);
  return { ut, positionByIndex, velocityByIndex, muByIndex, withdrawnByIndex };
}

/**
 * The gravitational acceleration at a point, summed over every body in the
 * catalogue as a point mass.
 *
 * Point masses and no field terms, deliberately. The oblateness this drops
 * reaches a frame's angular velocity only through the component of the
 * acceleration orthogonal to the pair's orbit plane, and there it is some eight
 * orders of magnitude below the angular velocity itself. The bodies this
 * KEEPS are the ones that matter: for the Earth-Moon pair the Sun's pull is
 * four orders of magnitude larger than the Earth's own bulge.
 *
 * `exclude` drops a body from the sum, which is how a body's own acceleration
 * is computed without dividing by its own zero separation.
 */
export function pointMassAccelerationAt(
  system: SystemInstant,
  at: Vec3Tuple,
  exclude?: number | null,
): Vec3Tuple {
  let sum: Vec3Tuple = ZERO;
  for (const [index, position] of system.positionByIndex) {
    if (index === exclude) continue;
    const mu = system.muByIndex.get(index);
    if (mu === undefined) continue;
    const offset = sub(position, at);
    const distance = norm(offset);
    if (!(distance > 0) || !Number.isFinite(distance)) continue;
    sum = add(sum, scale(offset, mu / (distance * distance * distance)));
  }
  return sum;
}

/**
 * The two sides of a rotating frame, as the sets they really are.
 *
 * A pulsating frame turns about two mass centres, and the sides are subtrees
 * rather than bodies: the primary side is the parent's system UP TO the
 * selected body, so a Sun-Earth frame's primary side is the Sun with Mercury and
 * Venus, and everything orbiting further out is excluded. Replicated rather than
 * simplified because a plausible-looking pair is a different frame from the one
 * the player can switch to, and the difference shows in where the origin sits.
 */
export interface FrameSides {
  primary: readonly number[];
  secondary: readonly number[];
}

function childrenOf(
  facts: CelestialFacts,
  body: CelestialBody,
): CelestialBody[] {
  return facts.bodies.filter(
    (b) => b.index !== body.index && b.referenceBody === body.name,
  );
}

function collectSystem(
  facts: CelestialFacts,
  centre: CelestialBody,
  end: CelestialBody | null,
  into: number[],
  depth: number,
): void {
  if (depth > MAX_PARENT_DEPTH) return;
  into.push(centre.index);
  for (const child of childrenOf(facts, centre)) {
    if (end !== null && child.index === end.index) return;
    collectSystem(facts, child, end, into, depth + 1);
  }
}

/**
 * The primary and secondary sides for a frame parameterised by one body.
 *
 * The centred and parent-direction frames have one body a side; only the
 * pulsating frame widens them, and it is the only caller that needs the sets.
 *
 * **The two rotating kinds put the parent on opposite sides, and that is
 * faithful rather than a slip.** A parent-direction frame is centred on the
 * selected body with the parent held out in front of it, so the selected body is
 * the primary. A pulsating frame is named for the pair in the other order, so
 * the parent's system is the primary and the selected body's is the secondary.
 * The visible consequence is that the first axis points at the parent in one
 * frame and away from it in the other; making them agree would mean drawing a
 * frame the player cannot switch to.
 */
export function frameSides(
  facts: CelestialFacts,
  choice: ReadFrameChoice,
): FrameSides | null {
  const selected = facts.bodies.find((b) => b.index === choice.bodyIndex);
  if (selected === undefined) return null;
  const parent = parentOf(facts, selected);
  if (choice.kind === "body-centred-inertial") {
    return { primary: [selected.index], secondary: [] };
  }
  if (parent === null) return null;
  if (choice.kind === "parent-direction") {
    return { primary: [selected.index], secondary: [parent.index] };
  }
  if (choice.kind === "rotating-pulsating") {
    const primary: number[] = [];
    const secondary: number[] = [];
    collectSystem(facts, parent, selected, primary, 0);
    collectSystem(facts, selected, null, secondary, 0);
    return { primary, secondary };
  }
  return null;
}

interface Barycentre {
  position: Vec3Tuple;
  velocity: Vec3Tuple;
  acceleration: Vec3Tuple;
}

/** The mass-weighted centre of one side, with the acceleration its own frame maths needs. */
function barycentreOf(
  system: SystemInstant,
  side: readonly number[],
): Barycentre | null {
  let mass = 0;
  let position: Vec3Tuple = ZERO;
  let velocity: Vec3Tuple = ZERO;
  for (const index of side) {
    const mu = system.muByIndex.get(index);
    const p = system.positionByIndex.get(index);
    const v = system.velocityByIndex.get(index);
    if (mu === undefined || p === undefined || v === undefined) continue;
    mass += mu;
    position = add(position, scale(p, mu));
    velocity = add(velocity, scale(v, mu));
  }
  if (!(mass > 0)) return null;
  position = scale(position, 1 / mass);
  velocity = scale(velocity, 1 / mass);
  // The acceleration of the side's mass centre is the sum of the external pulls
  // on each member weighted the same way, and the members' pulls on each other
  // cancel out of it by Newton's third law. Evaluating the field once at the
  // mass centre would be a different quantity for a side with more than one
  // body in it.
  let acceleration: Vec3Tuple = ZERO;
  for (const index of side) {
    const mu = system.muByIndex.get(index);
    const p = system.positionByIndex.get(index);
    if (mu === undefined || p === undefined) continue;
    let external = pointMassAccelerationAt(system, p, index);
    for (const other of side) {
      if (other === index) continue;
      const otherMu = system.muByIndex.get(other);
      const otherPosition = system.positionByIndex.get(other);
      if (otherMu === undefined || otherPosition === undefined) continue;
      const offset = sub(otherPosition, p);
      const distance = norm(offset);
      if (!(distance > 0) || !Number.isFinite(distance)) continue;
      external = sub(
        external,
        scale(offset, otherMu / (distance * distance * distance)),
      );
    }
    acceleration = add(acceleration, scale(external, mu));
  }
  acceleration = scale(acceleration, 1 / mass);
  return { position, velocity, acceleration };
}

/**
 * Returns a frame's state at `ut`, or `null` when the catalogue cannot form
 * it: the body is not in the catalogue, the frame needs a parent the body does
 * not have, or the two bodies are in the same place. Show `null` as "cannot
 * draw in this frame". Pass a `system` from {@link systemInstantAt} when you
 * already have one for this instant.
 *
 * @category Frames of reference
 */
export function frameInstantAt(
  facts: CelestialFacts,
  choice: ReadFrameChoice,
  ut: number,
  system?: SystemInstant,
): FrameInstant | null {
  if (!Number.isFinite(ut)) return null;
  const sides = frameSides(facts, choice);
  if (sides === null) return null;
  const state = system ?? systemInstantAt(facts, ut);

  if (choice.kind === "body-centred-inertial") {
    const origin = state.positionByIndex.get(sides.primary[0]);
    const originVelocity = state.velocityByIndex.get(sides.primary[0]);
    if (origin === undefined || originVelocity === undefined) return null;
    return {
      ut,
      origin,
      originVelocity,
      basis: IDENTITY,
      angularVelocity: ZERO,
      unitLength: 1,
      unitLengthRate: 0,
      scaleConvention: TRAJECTORY_SCALE_CONVENTIONS.metres,
    };
  }

  const primary = barycentreOf(state, sides.primary);
  const secondary = barycentreOf(state, sides.secondary);
  if (primary === null || secondary === null) return null;

  // The separation runs primary to secondary, so the frame's first axis points
  // at the body being held on a bearing. Reversing it would leave every drawn
  // curve mirrored, with nothing to say it had happened.
  const r = sub(secondary.position, primary.position);
  const rDot = sub(secondary.velocity, primary.velocity);
  const rDotDot = sub(secondary.acceleration, primary.acceleration);

  const f = unit(r);
  const bRaw = cross(r, rDot);
  const b = unit(bRaw);
  if (f === null || b === null) return null;
  const nRaw = cross(bRaw, r);
  const n = unit(nRaw);
  if (n === null) return null;

  const bDotRaw = cross(r, rDotDot);
  const nDotRaw = add(cross(bDotRaw, r), cross(bRaw, rDot));
  const fRate = normalisedRate(r, rDot);
  const bRate = normalisedRate(bRaw, bDotRaw);
  const nRate = normalisedRate(nRaw, nDotRaw);
  if (fRate === null || bRate === null || nRate === null) return null;

  // The frame's angular velocity from its own triad's rates. Each term is one
  // axis turning about another; the third needs no acceleration at all and is
  // the bulk of it, which is why a two-body shortcut here is a term deleted
  // rather than a term approximated.
  const angularVelocity = add(
    add(scale(f, dot(nRate, b)), scale(n, dot(bRate, f))),
    scale(b, dot(fRate, n)),
  );

  const basis: readonly [Vec3Tuple, Vec3Tuple, Vec3Tuple] = [f, n, b];

  if (choice.kind === "parent-direction") {
    const origin = state.positionByIndex.get(sides.primary[0]);
    const originVelocity = state.velocityByIndex.get(sides.primary[0]);
    if (origin === undefined || originVelocity === undefined) return null;
    return {
      ut,
      origin,
      originVelocity,
      basis,
      angularVelocity,
      unitLength: 1,
      unitLengthRate: 0,
      scaleConvention: TRAJECTORY_SCALE_CONVENTIONS.metres,
    };
  }

  // Rotating-pulsating. The origin is the mass centre of both sides together,
  // not of either one, and the length unit is their separation.
  const both = barycentreOf(state, [...sides.primary, ...sides.secondary]);
  if (both === null) return null;
  const unitLength = norm(r);
  if (!(unitLength > 0) || !Number.isFinite(unitLength)) return null;
  return {
    ut,
    origin: both.position,
    originVelocity: both.velocity,
    basis,
    angularVelocity,
    unitLength,
    unitLengthRate: dot(r, rDot) / unitLength,
    scaleConvention: TRAJECTORY_SCALE_CONVENTIONS.separationAtPointInstant,
  };
}

/**
 * Returns a position relative to the root body, and optionally a velocity, in
 * a frame's coordinates. Converting only a position is cheaper.
 *
 * @category Frames of reference
 */
export function toFrame(
  instant: FrameInstant,
  positionInertial: Vec3Tuple,
  velocityInertial?: Vec3Tuple,
): FrameCoordinates {
  const [ex, ey, ez] = instant.basis;
  const dq = sub(positionInertial, instant.origin);
  const rotated: Vec3Tuple = [dot(ex, dq), dot(ey, dq), dot(ez, dq)];

  let velocity: Vec3Tuple = ZERO;
  if (velocityInertial !== undefined) {
    const dv = sub(velocityInertial, instant.originVelocity);
    const w = instant.angularVelocity;
    const wFrame: Vec3Tuple = [dot(ex, w), dot(ey, w), dot(ez, w)];
    velocity = sub(
      [dot(ex, dv), dot(ey, dv), dot(ez, dv)],
      cross(wFrame, rotated),
    );
  }

  if (instant.unitLength === 1 && instant.unitLengthRate === 0) {
    return { position: rotated, velocity };
  }
  const k = 1 / instant.unitLength;
  return {
    position: scale(rotated, k),
    velocity: scale(
      sub(
        velocity,
        scale(rotated, instant.unitLengthRate / instant.unitLength),
      ),
      k,
    ),
  };
}

/**
 * Returns a frame choice with `follow-control-frame` replaced by the frame
 * the player has selected, or `null` when there is none to follow, which is
 * usual: draw in the frame the data arrived in then. Any other choice is
 * returned as it is.
 *
 * @category Frames of reference
 * @categoryDescription Frames of reference
 * Where a point is in the frame you chose to draw it in: choosing a frame,
 * resolving it to a state at one instant, converting positions to and from it,
 * and the Lagrange points of a pair of bodies. For an Uplink that contributes a
 * projection or a trajectory.
 */
export function resolveReadFrame(
  choice: ReadFrameChoice,
  controlFrame: ReadFrameChoice | null | undefined,
): ReadFrameChoice | null {
  if (choice.kind !== "follow-control-frame") return choice;
  if (controlFrame == null) return null;
  // A control frame that itself said "follow the control frame" would be a
  // cycle. No real descriptor produces one; answering null is the reading that
  // draws something rather than recursing.
  return controlFrame.kind === "follow-control-frame" ? null : controlFrame;
}

/**
 * Returns a position given in a frame's coordinates as a position relative to
 * the root body, in metres: the reverse of {@link toFrame}, for positions
 * only. Use it for a point fixed in a frame, such as a libration point, to
 * measure distances to it or draw it in another frame.
 *
 * @category Frames of reference
 */
export function fromFrame(
  instant: FrameInstant,
  positionInFrame: Vec3Tuple,
): Vec3Tuple {
  const [ex, ey, ez] = instant.basis;
  const scaled = scale(positionInFrame, instant.unitLength);
  return add(
    instant.origin,
    add(add(scale(ex, scaled[0]), scale(ey, scaled[1])), scale(ez, scaled[2])),
  );
}
