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

  return { integration, pad, resources, total: pad + integration + resources };
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

  let total = 0;
  for (const [name, amount] of spec.resources) {
    const entry = offered.find((r) => r.name === name);
    const perUnit = spec.isHangar
      ? entry?.hangarCostPerUnit
      : entry?.padCostPerUnit;
    const magnitude = perUnit?.magnitude;
    if (magnitude == null) {
      return null;
    }
    // RP-1 stores whole units, rounding up, so the price is of what it stores.
    total += Math.ceil(amount) * magnitude;
  }
  return total;
}
