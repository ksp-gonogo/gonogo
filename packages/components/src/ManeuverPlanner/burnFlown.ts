import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import { hydrate, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import type { BurnConformancePhase, ThrustObservation } from "./conformance";

/** The three elements a burn changes that the planner can read off both the craft and a node's resulting orbit. */
export interface OrbitShape {
  sma: Value<"m">;
  ecc: Value<"1">;
  inc: Value<"°">;
}

/** An orbit shape from bare readings: metres, a ratio and degrees. */
export function orbitShape(sma: number, ecc: number, inc: number): OrbitShape {
  return { sma: value("m", sma), ecc: value("1", ecc), inc: value("°", inc) };
}

/*
 * The tolerances are the size of a pilot's miss, not of a rounding error. A
 * relative 0.1% of the semi-major axis is about 1 m/s of prograde on a 700 km
 * orbit; 0.002 of eccentricity and 0.1 degrees of inclination are the same
 * order for a burn along the other axes. Wider would let a burn that stopped
 * short read as flown; narrower would never match one flown by hand. A burn
 * that misses by more stays in the plan, which costs the operator a click,
 * where a wrong match deletes a plan.
 */
export const SMA_TOLERANCE_FRACTION = 0.001;
export const ECC_TOLERANCE = value("1", 0.002);
export const INC_TOLERANCE = value("°", 0.1);

/** What the tracker keeps for one planned burn between samples. */
export interface BurnWatch {
  /** The burn as planned: when it happens and its three components, so an edit starts a fresh watch. */
  key: string;
  /** The orbit the burn was planned to leave the craft on, taken before ignition and held through the burn. Null when the plan was first seen once the burn was under way. */
  target: OrbitShape | null;
  /** Whether the craft's orbit was seen to differ from the target. A burn planned onto the orbit the craft is already on never sets it. */
  mismatchSeen: boolean;
}

/** What each sample brings besides the plan. */
export interface BurnContext {
  /** The view instant, UT seconds. */
  nowUt: number | null;
  /** The craft's orbit now, or null where it is not known. */
  current: OrbitShape | null;
  /** The propulsion latch; undefined is no observation, never engines off. */
  thrust: ThrustObservation | undefined;
}

export function shapesDiffer(a: OrbitShape, b: OrbitShape): boolean {
  return (
    a.sma
      .minus(b.sma)
      .abs()
      .greaterThan(b.sma.abs().times(SMA_TOLERANCE_FRACTION)) ||
    a.ecc.minus(b.ecc).abs().greaterThan(ECC_TOLERANCE) ||
    a.inc.minus(b.inc).abs().greaterThan(INC_TOLERANCE)
  );
}

function keyOf(node: ParsedManeuverNode): string {
  return `${node.UT}|${node.deltaV.join(",")}`;
}

function targetOf(node: ParsedManeuverNode): OrbitShape | null {
  const patch = node.orbitPatches[0];
  if (!patch) return null;
  // A recorded frame replayed as plain JSON carries each quantity without its methods.
  const sma = hydrate(patch.sma);
  const ecc = hydrate(patch.ecc);
  const inc = hydrate(patch.inc);
  if (!sma?.isFinite() || !ecc?.isFinite() || !inc?.isFinite()) return null;
  return { sma, ecc, inc };
}

/** Whether the burn has begun in view time; without an ignition instant, the node's own instant stands in. */
function underway(node: ParsedManeuverNode, nowUt: number): boolean {
  return nowUt >= (node.ignitionUt ?? node.UT);
}

/**
 * The next watch for a burn. Before ignition the target follows the plan's
 * resulting orbit, since the craft has not moved it yet; once the burn is under
 * way the target is held, because the solver recomputes the resulting orbit
 * from the craft's changing orbit and would move the goal as the burn
 * proceeds.
 */
export function watchBurn(
  prev: BurnWatch | undefined,
  node: ParsedManeuverNode,
  ctx: BurnContext,
): BurnWatch {
  const key = keyOf(node);
  const fresh = prev === undefined || prev.key !== key;
  if (ctx.nowUt === null) {
    return fresh ? { key, target: null, mismatchSeen: false } : prev;
  }
  if (!underway(node, ctx.nowUt)) {
    const target = targetOf(node);
    return {
      key,
      target,
      mismatchSeen:
        target !== null && ctx.current !== null
          ? shapesDiffer(ctx.current, target)
          : false,
    };
  }
  if (fresh) return { key, target: null, mismatchSeen: false };
  if (prev.target === null || prev.mismatchSeen || ctx.current === null) {
    return prev;
  }
  return shapesDiffer(ctx.current, prev.target)
    ? { ...prev, mismatchSeen: true }
    : prev;
}

/** Whether thrust was seen on after ignition. Null when there is no observation or no ignition instant to measure from. */
function thrustSeenSinceIgnition(
  node: ParsedManeuverNode,
  thrust: ThrustObservation | undefined,
): boolean | null {
  if (thrust === undefined || node.ignitionUt === null) return null;
  if (thrust.thrusting) return true;
  return thrust.lastThrustEndUt !== null
    ? thrust.lastThrustEndUt >= node.ignitionUt
    : false;
}

/**
 * Whether the burn was flown: its cutoff has passed, thrust was seen on after
 * ignition and is now off, and the craft sits on the orbit the plan promised
 * after having been seen off it. The planned magnitude plays no part: the
 * node's delta-v is what was asked for and does not fall as the burn is flown.
 */
export function burnFlown(
  watch: BurnWatch,
  node: ParsedManeuverNode,
  ctx: BurnContext,
): boolean {
  if (ctx.nowUt === null || node.cutoffUt === null) return false;
  if (ctx.nowUt < node.cutoffUt) return false;
  if (ctx.thrust === undefined || ctx.thrust.thrusting) return false;
  if (thrustSeenSinceIgnition(node, ctx.thrust) !== true) return false;
  if (watch.target === null || !watch.mismatchSeen || ctx.current === null) {
    return false;
  }
  return !shapesDiffer(ctx.current, watch.target);
}

/**
 * How far an engine's start may fall outside a burn's planned window and still
 * be the burn toward that node: a pilot lights a little early or late, and an
 * unrelated burn long before or after is not this one.
 */
const BURN_ATTRIBUTION_SLACK = value("s", 10);

/** The instants of one planned burn. */
export interface BurnInstants {
  ut: Value<"ut">;
  ignitionUt: Value<"ut"> | null;
  cutoffUt: Value<"ut"> | null;
}

/**
 * Whether the engine now lit is the burn toward this node: it started within
 * the burn's planned window, give or take the slack. Pass null for an engine
 * that is not thrusting. The clock alone cannot say a burn is over, since the
 * planned cutoff is recomputed from the craft as it burns and a pilot's burn
 * runs past it, so a node counts as flown only once this is false.
 */
export function engineLitFor(
  burn: BurnInstants,
  thrustStartedUt: Value<"ut"> | null | undefined,
): boolean {
  if (thrustStartedUt === null || thrustStartedUt === undefined) return false;
  const from = (burn.ignitionUt ?? burn.ut).minus(BURN_ATTRIBUTION_SLACK);
  const to = (burn.cutoffUt ?? burn.ut).plus(BURN_ATTRIBUTION_SLACK);
  return (
    thrustStartedUt.greaterThanOrEqual(from) &&
    thrustStartedUt.lessThanOrEqual(to)
  );
}

/** Where the burn is, from the clock, the thrust latch and whether it was flown; `unknown` where the readings cannot say. */
export function burnPhase(
  watch: BurnWatch,
  node: ParsedManeuverNode,
  ctx: BurnContext,
): BurnConformancePhase {
  if (
    ctx.nowUt === null ||
    node.ignitionUt === null ||
    node.cutoffUt === null
  ) {
    return "unknown";
  }
  if (burnFlown(watch, node, ctx)) return "delivered";
  if (ctx.nowUt < node.ignitionUt) return "not-started";
  const seen = thrustSeenSinceIgnition(node, ctx.thrust);
  if (seen === null) return "unknown";
  if (ctx.thrust?.thrusting) return "in-progress";
  return seen ? "stopped-short" : "not-started";
}

/** Whether the burn's window has closed with no thrust seen in it: the one case where nothing delivered is known rather than unmeasured. */
export function burnNeverLit(
  node: ParsedManeuverNode,
  ctx: BurnContext,
): boolean {
  if (ctx.nowUt === null || node.cutoffUt === null) return false;
  if (ctx.nowUt < node.cutoffUt) return false;
  return thrustSeenSinceIgnition(node, ctx.thrust) === false;
}
