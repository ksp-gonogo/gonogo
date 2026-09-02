import { magnitudeOf } from "@ksp-gonogo/ui-kit";
import type { Rp1LcPricing } from "../__generated__/contract";

/**
 * What RP-1 would charge to build a complex to a given specification.
 *
 * <para><b>Why this arithmetic is here and not on the wire.</b> Every other price
 * this Uplink shows is computed where RP-1 lives, because it is a price OF
 * something that already exists and so has somewhere to be attached. A new
 * complex is priced against what the operator is still typing. Asking the mod per
 * keystroke is not available: these commands are delay-aware, and a career
 * commanding from a remote vantage would wait minutes for each quote, so a form
 * that could not price until a round trip returned could not price at all.</para>
 *
 * <para><b>The split is by whether the arithmetic needs GAME DATA.</b> What is
 * below touches none: it is a closed form over the tonnage, the envelope and the
 * human rating the operator entered, transcribed from `LCData.GetCostStats` in the
 * shipped RP0.dll and pinned by tests against the same cases the C#
 * `Rp1LcCostModel` is pinned to. The resource term is NOT transcribed, because its
 * factors come from a RealFuels tank definition, a KSP resource definition and an
 * RP-1 settings dictionary; those arrive per resource on `rp1.lcPricing` as a
 * funds-per-unit figure, which is exact rather than approximate because RP-1's own
 * expression is linear in the amount.</para>
 *
 * <para>A quote is refused rather than estimated when anything it needs is
 * missing. A form that quoted a complex under its true cost would be worse than
 * one that quoted nothing.</para>
 */
export interface LcSpec {
  massMax: number;
  sizeMaxWidth: number;
  sizeMaxHeight: number;
  sizeMaxDepth: number;
  humanRated: boolean;
  isHangar: boolean;
  /** Capacity per KSP resource name, in units. */
  resources: ReadonlyMap<string, number>;
}

export interface LcQuote {
  pad: number;
  integration: number;
  resources: number;
  total: number;
}

/**
 * RP-1 charges the pad half as a curve over tonnage, with a second term that only
 * bites above 350 t, and the integration half over the squared magnitude of the
 * envelope. A hangar has no pad at all and stretches its own height fivefold
 * before measuring, which is not a special case bolted on: it is what RP-1 does.
 */
export function quoteNewComplex(
  spec: LcSpec,
  pricing: Rp1LcPricing | undefined,
): LcQuote | null {
  const resources = quoteResources(spec, pricing);
  if (resources === null) {
    return null;
  }
  const stats = costStats(spec);
  if (stats === null) {
    return null;
  }
  return {
    integration: stats.integration,
    pad: stats.pad,
    resources,
    total: stats.pad + stats.integration + resources,
  };
}

/**
 * The pad and integration halves of a specification, which is RP-1's own
 * `GetCostStats` minus the resource term.
 *
 * <para>Apart from `quoteNewComplex` because a renovation needs it TWICE, for
 * the specification the complex stands at and the one it is being renovated to,
 * and the resource term is not a function of either alone.</para>
 */
function costStats(
  spec: Omit<LcSpec, "resources">,
): { pad: number; integration: number } | null {
  const x = spec.sizeMaxWidth;
  let y = spec.sizeMaxHeight;
  const z = spec.sizeMaxDepth;
  if (![spec.massMax, x, y, z].every((n) => Number.isFinite(n) && n >= 0)) {
    return null;
  }

  let pad = 0;
  if (spec.isHangar) {
    y *= 5;
  } else {
    const m = spec.massMax;
    pad =
      Math.max(0, m ** 0.65 * 2000 + Math.max(m - 350, 0) ** 1.5 * 2 - 2500) +
      500;
  }

  let integration = Math.max(1000, (x * x + y * y + z * z) * 25);
  if (spec.humanRated) {
    pad *= 1.5;
    integration *= 2;
  }
  pad *= 0.5;
  integration *= 0.5;

  return { integration, pad };
}

/** RP-1's floor on the pad half of any renovation that moves the tonnage limit. */
const MASS_CHANGE_COST_FLOOR = 1000;

/** A complex as it stands, which a renovation is priced as a difference from. */
export interface LcCurrent extends LcSpec {
  /**
   * The tonnage the complex was ORIGINALLY built at, which a renovation carries
   * through unchanged. It fixes the legal envelope AND it is the curve the
   * per-metre integration charge is lerped over, so a renovation priced against
   * the new limit instead would misprice every axis.
   */
  massOrig: number;
  /**
   * How many of the complex's pads are OPERATIONAL. Every one of them is rebuilt
   * by a renovation, so the pad half is scaled once for each beyond the first.
   */
  launchPadCount: number;
}

export interface LcModifyQuote {
  total: number;
  /**
   * The renovation reduces the complex's integration half. The case an operator
   * most needs told about, because it is the one where a bill arrives for making
   * something smaller.
   */
  isDowngrade: boolean;
}

/**
 * What RP-1 would charge to renovate a complex the career already has.
 *
 * <para><b>A difference, not a price, and asymmetric in both halves.</b> Growing
 * costs the whole difference; shrinking costs half of it, in the pad half by
 * construction and in the integration half by an explicit halving. So a
 * renovation is never free and never a refund, which is the thing an operator
 * shrinking a complex is most likely to get wrong.</para>
 *
 * <para><b>Three clauses a transcription drops.</b> Any movement of the tonnage
 * limit at all carries a floor of 1,000 funds, on the PAD half only rather than
 * on the total. The integration half's per-metre rate is a curve over
 * `massOrig`, so a complex originally built big pays more per metre of envelope
 * than a small one whatever it is renovated into. And a growth is capped at what
 * the finished specification would have cost outright, because rebuilding cannot
 * cost more than building.</para>
 *
 * <para><b>It REFUSES a change of resources rather than pricing one.</b> RP-1
 * charges the resource difference at 0.6 of a fresh tank and a reduction at a
 * tenth, off factors that arrive per resource on `rp1.lcPricing` for a PAD only
 * (see `quoteResources`). Rather than quote a renovation under its true cost,
 * this answers only for a renovation that keeps the complex's fluids as they
 * are, which is what the control that calls it offers.</para>
 */
export function quoteModifyComplex(
  next: LcSpec,
  current: LcCurrent,
  pricing: Rp1LcPricing | undefined,
): LcModifyQuote | null {
  if (!sameResources(next.resources, current.resources)) {
    return null;
  }

  const newCost = costStats(next);
  const currentCost = costStats(current);
  if (newCost === null || currentCost === null) {
    return null;
  }
  if (
    !Number.isFinite(current.massOrig) ||
    !Number.isFinite(current.launchPadCount)
  ) {
    return null;
  }

  let padHalf = 0;
  if (!next.isHangar) {
    padHalf =
      newCost.pad > currentCost.pad
        ? newCost.pad - currentCost.pad
        : (currentCost.pad - newCost.pad) * 0.5;

    const pads = current.launchPadCount;
    if (pads > 1) {
      /*
       * RP-1's own setting, off the wire rather than assumed: a renovation
       * reprices every pad the complex already has, so a career whose
       * additional-pad multiplier has been retuned would be quoted against the
       * wrong one. Refused rather than defaulted when it has not arrived, on the
       * same rule the resource half follows: a quote under its true cost is
       * worse than no quote.
       */
      const mult = magnitudeOf(pricing?.additionalPadCostMult);
      if (mult === null) {
        return null;
      }
      padHalf *= 1 + (pads - 1) * mult;
    }

    if (
      !approximately(current.massMax, next.massMax) &&
      padHalf < MASS_CHANGE_COST_FLOOR
    ) {
      padHalf = MASS_CHANGE_COST_FLOOR;
    }
  }

  const metreRate = next.isHangar
    ? 500
    : lerpUnclamped(
        100,
        1000,
        inverseLerp(10, 55, clamp(current.massOrig, 10, 50)),
      );

  let integrationHalf =
    Math.abs(newCost.integration - currentCost.integration) +
    axisDelta(next.sizeMaxHeight, current.sizeMaxHeight) * metreRate +
    axisDelta(next.sizeMaxWidth, current.sizeMaxWidth) * metreRate * 0.5 +
    axisDelta(next.sizeMaxDepth, current.sizeMaxDepth) * metreRate * 0.5;

  const isDowngrade = newCost.integration < currentCost.integration;
  if (isDowngrade) {
    integrationHalf *= 0.5;
  } else if (
    newCost.integration > currentCost.integration &&
    integrationHalf > newCost.integration
  ) {
    integrationHalf = newCost.integration;
  }

  return { isDowngrade, total: padHalf + integrationHalf };
}

/** Whether two resource sets are the same set with the same capacities. */
function sameResources(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [name, amount] of a) {
    if (b.get(name) !== amount) {
      return false;
    }
  }
  return true;
}

/**
 * Unity's `Mathf.Approximately`, which is what RP-1 uses to decide whether the
 * tonnage limit moved at all: the test that costs 1,000 funds when it says yes.
 * A plain inequality here would charge that floor for a difference in the last
 * bit of a float.
 */
function approximately(a: number, b: number): boolean {
  return (
    Math.abs(b - a) <
    Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), FLOAT_EPSILON * 8)
  );
}

/** C#'s `float.Epsilon`: the smallest denormal, not the machine epsilon. */
const FLOAT_EPSILON = 1.401298464324817e-45;

/** KSP's `UtilMath.LerpUnclamped`. */
function lerpUnclamped(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** KSP's `UtilMath.InverseLerp`. Its one call site feeds it an already-clamped value. */
function inverseLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : (value - a) / (b - a);
}

/** KSP's `UtilMath.Clamp`. */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * One axis of the envelope's movement, narrowed to float exactly where RP-1
 * narrows it.
 *
 * <para>Both operands are `Vector3` float fields, so RP-1's subtraction happens
 * in float and only then widens. Subtracting first would keep precision RP-1 has
 * already thrown away and produce a different price for a non-integral
 * envelope.</para>
 */
function axisDelta(a: number, b: number): number {
  return Math.abs(Math.fround(a) - Math.fround(b));
}

/**
 * The resource half, multiplied out from the per-unit prices RP-1 sent.
 *
 * <para>A resource the operator has chosen that carries no price for this kind of
 * complex refuses the whole quote. RP-1 would not accept it either, and a quote
 * that silently dropped it would name a price for a complex nobody can build.</para>
 */
function quoteResources(
  spec: LcSpec,
  pricing: Rp1LcPricing | undefined,
): number | null {
  if (spec.resources.size === 0) {
    return 0;
  }
  const offered = pricing?.resources;
  if (offered == null) {
    return null;
  }

  /*
   * Pads only, because only a pad can be BUILT: a career's one hangar is seeded at
   * career start and there is no renovation control, so the wire carries no hangar
   * price and a hangar with resources is refused rather than guessed at.
   */
  if (spec.isHangar) {
    return null;
  }

  let total = 0;
  for (const [name, amount] of spec.resources) {
    const entry = offered.find((r) => r.name === name);
    const magnitude = entry?.padCostPerUnit?.magnitude;
    if (magnitude == null) {
      return null;
    }
    // RP-1 stores whole units, rounding up, so the price is of what it stores.
    total += Math.ceil(amount) * magnitude;
  }
  return total;
}
