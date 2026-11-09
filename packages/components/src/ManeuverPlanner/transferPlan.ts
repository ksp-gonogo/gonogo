/**
 * The Maneuver Planner's transfer to another body, from the game's body catalogue and the craft's own orbit.
 *
 * Not a reckoner: the plan solves a burn that nobody has flown against body positions at instants that have not happened, so there is no observed value being carried and no Topic it belongs to. Bodies are advanced with the same two-body propagation the Transfer Window falls back to.
 */
import {
  type BodyTransferPlan,
  type ManeuverPlan,
  planMoonTransfer,
  planParentReturn,
  planPlanetTransfer,
} from "@ksp-gonogo/core";
import {
  type CelestialBody,
  type OrbitElements,
  solve,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";

const degToRad = (deg: number): number => (deg * Math.PI) / 180;

export interface TransferContext {
  /** The craft's orbit about its body, in radians. */
  craft: OrbitElements;
  /** The body the craft orbits. */
  craftBody: CelestialBody;
  /** The body to transfer to. */
  target: CelestialBody;
  bodies: readonly CelestialBody[];
  /** Periapsis altitude to aim for at the target, metres. */
  periapsisAltitude: number;
  /** The instant to plan from, UT seconds. */
  nowUt: number;
}

/**
 * Whether the target is a moon of the craft's body, the body the craft's body
 * orbits, or another body of the craft body's own parent, the three a single
 * burn can be planned to; null for any other. A star is never a parent to
 * return to.
 */
export function transferKind(
  craftBody: CelestialBody,
  target: CelestialBody,
): "moon" | "parent" | "planet" | null {
  if (target.name === craftBody.name) return null;
  if (
    target.name !== null &&
    target.name === craftBody.referenceBody &&
    target.referenceBody !== null
  ) {
    return "parent";
  }
  if (
    target.referenceBody !== null &&
    target.referenceBody === craftBody.name
  ) {
    return "moon";
  }
  if (
    craftBody.referenceBody !== null &&
    target.referenceBody === craftBody.referenceBody
  ) {
    return "planet";
  }
  return null;
}

/** The bodies a transfer can be planned to from `craftBody`: its moons first, then its parent, then its parent's other bodies. */
export function transferTargets(
  bodies: readonly CelestialBody[],
  craftBody: CelestialBody | undefined,
): CelestialBody[] {
  if (!craftBody) return [];
  const named = (b: CelestialBody) => b.name !== null;
  const moons = bodies.filter(
    (b) => named(b) && transferKind(craftBody, b) === "moon",
  );
  const parent = bodies.filter(
    (b) => named(b) && transferKind(craftBody, b) === "parent",
  );
  const siblings = bodies.filter(
    (b) => named(b) && transferKind(craftBody, b) === "planet",
  );
  return [...moons, ...parent, ...siblings];
}

/** A body's own orbit as propagation elements, or null while any of them has not arrived. */
export function bodyElements(
  body: CelestialBody,
  bodies: readonly CelestialBody[],
): OrbitElements | null {
  const mu = bodies.find((b) => b.name === body.referenceBody)?.gravParameter;
  if (
    mu == null ||
    body.semiMajorAxis == null ||
    body.eccentricity == null ||
    body.inclination == null ||
    body.lan == null ||
    body.argumentOfPeriapsis == null ||
    body.meanAnomalyAtEpoch == null ||
    body.epoch == null
  ) {
    return null;
  }
  return {
    sma: body.semiMajorAxis,
    ecc: body.eccentricity,
    inc: degToRad(body.inclination),
    lan: degToRad(body.lan),
    argPe: degToRad(body.argumentOfPeriapsis),
    meanAnomalyAtEpoch: body.meanAnomalyAtEpoch,
    epoch: body.epoch,
    mu,
  };
}

const periodOf = (e: OrbitElements): number =>
  2 * Math.PI * Math.sqrt(e.sma ** 3 / e.mu);

/**
 * The single burn that sends the craft to the target body, as a plan the
 * planner can add as a node. Null while any body figure it needs has not
 * arrived, for a craft on an escape orbit, and for a target a single burn
 * cannot reach.
 */
export function planBodyTransfer(ctx: TransferContext): ManeuverPlan | null {
  const { craft, craftBody, target, bodies, nowUt } = ctx;
  const kind = transferKind(craftBody, target);
  if (kind === null || !(craft.ecc < 1) || !(craft.sma > 0)) return null;
  const targetElements = bodyElements(target, bodies);
  if (
    !targetElements ||
    target.radius == null ||
    target.gravParameter == null ||
    craftBody.gravParameter == null
  ) {
    return null;
  }
  const craftPeriod = periodOf(craft);
  const craftState = (ut: number) => solve(craft, ut);

  let plan: BodyTransferPlan | null = null;
  if (kind === "parent") {
    const originElements = bodyElements(craftBody, bodies);
    if (!originElements || craftBody.soi == null) return null;
    plan = planParentReturn({
      muParent: target.gravParameter,
      parentRadius: target.radius,
      origin: {
        state: (ut) => solve(originElements, ut),
        mu: craftBody.gravParameter,
        soi: craftBody.soi,
        period: periodOf(originElements),
      },
      craft: craftState,
      craftPeriod,
      nowUt,
      periapsisAltitude: ctx.periapsisAltitude,
    });
  }
  if (kind === "moon") {
    if (target.soi == null) return null;
    plan = planMoonTransfer({
      mu: craft.mu,
      craft: craftState,
      craftPeriod,
      nowUt,
      moon: {
        state: (ut) => solve(targetElements, ut),
        mu: target.gravParameter,
        radius: target.radius,
        period: periodOf(targetElements),
        soi: target.soi,
      },
      periapsisAltitude: ctx.periapsisAltitude,
    });
  }
  if (kind === "planet") {
    const originElements = bodyElements(craftBody, bodies);
    const parentMu = targetElements.mu;
    if (!originElements || craftBody.soi == null) return null;
    plan = planPlanetTransfer({
      muParent: parentMu,
      origin: {
        state: (ut) => solve(originElements, ut),
        mu: craftBody.gravParameter,
        soi: craftBody.soi,
        sma: originElements.sma,
        period: periodOf(originElements),
      },
      dest: {
        state: (ut) => solve(targetElements, ut),
        mu: target.gravParameter,
        radius: target.radius,
        sma: targetElements.sma,
        period: periodOf(targetElements),
      },
      craft: craftState,
      craftPeriod,
      nowUt,
      periapsisAltitude: ctx.periapsisAltitude,
    });
  }
  if (!plan || target.name === null) return null;
  return {
    ut: value("ut", plan.burnUt),
    prograde: plan.prograde,
    normal: plan.normal,
    radial: plan.radial,
    requiredDeltaV: plan.deltaV,
    projected: null,
    transfer: {
      target: target.name,
      transferTime: plan.transferTime,
      arrivalUt: plan.arrivalUt,
      periapsisAltitude: plan.periapsisAltitude,
    },
  };
}
