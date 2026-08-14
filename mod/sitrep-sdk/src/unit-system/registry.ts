import { UNIT_DEFINITIONS, type UnitDefinition } from "./definitions";
import * as Dim from "./dimension";

/**
 * What a caller hands {@link registerUnit}.
 *
 * A unit is declared either by its DIMENSION outright, or by naming the
 * components it is composed from. `{ of: "m", per: "s" }` is the same
 * declaration as `{ dimension: { m: 1, s: -1 } }` and is usually easier to
 * read, but it also means the components have to exist, which is the point:
 * a compound built on a symbol nobody registered is a typo, and it should say
 * so at registration rather than render as nonsense three screens later.
 */
export interface UnitRegistration {
  readonly symbol: string;
  /** What the value MEANS. Display only; it never gates arithmetic. */
  readonly kind: string;
  /** Exponent map. Mutually exclusive with `of` / `per`. */
  readonly dimension?: Dim.Dimension;
  /** Numerator component symbol, for a compound. */
  readonly of?: string;
  /** Denominator component symbol, for a compound. */
  readonly per?: string;
  /** Multiplier onto the dimension's base unit. Defaults to 1. */
  readonly ratio?: number;
  /** Logarithmic, so never prefix-scaled. */
  readonly log?: true;
}

/**
 * Symbols whose meaning is settled and must not be re-declared.
 *
 * SI already resolved the metres/minutes collision, and it resolved it in
 * favour of metres: minutes are `min`. Without this, a mod registering `m` for
 * minutes would silently make every altitude on the dashboard a duration,
 * which is the one collision severe enough to be worth a hard error.
 */
const RESERVED: ReadonlyArray<{
  symbol: string;
  dimension: Dim.Dimension;
  why: string;
}> = [
  {
    symbol: "m",
    dimension: { m: 1 },
    why: "`m` is metres. Minutes are `min`, which is what SI settled on for exactly this collision.",
  },
];

/**
 * Splits `snacks:g` into its namespace and the glyph an operator reads.
 *
 * A unit TOKEN may be namespaced; the SYMBOL it displays as never is. This is
 * how two mods can both call something `g` without either having to give the
 * name up, and it is not a new idea here: `irl:s` is the first-party instance
 * of the same problem, where real seconds and game seconds share a glyph and
 * must not share a dimension.
 */
export function displaySymbol(token: string): string {
  const colon = token.indexOf(":");
  return colon === -1 ? token : token.slice(colon + 1);
}

/** The declaring namespace, or `undefined` for a first-party token. */
export function namespaceOf(token: string): string | undefined {
  const colon = token.indexOf(":");
  return colon === -1 ? undefined : token.slice(0, colon);
}

const registry = new Map<string, UnitDefinition>();
/** Every declared unit sharing a dimension, in registration order. */
const byDimension = new Map<string, string[]>();

function index(symbol: string, definition: UnitDefinition): void {
  registry.set(symbol, definition);
  const dimensionKey = Dim.key(definition.dim);
  const existing = byDimension.get(dimensionKey) ?? [];
  if (!existing.includes(symbol)) {
    existing.push(symbol);
  }
  byDimension.set(dimensionKey, existing);
}

/** Restores the first-party catalog and drops everything registered on top. */
export function resetUnitRegistry(): void {
  registry.clear();
  byDimension.clear();
  for (const [symbol, definition] of Object.entries(UNIT_DEFINITIONS)) {
    index(symbol, definition);
  }
}
resetUnitRegistry();

/**
 * The two component symbols either side of the first "/" in a compound
 * token, or `undefined` when the token is not shaped like one: no slash, or
 * an empty side (`"/s"`, `"bit/"`).
 */
function splitCompound(token: string): readonly [string, string] | undefined {
  const slash = token.indexOf("/");
  if (slash <= 0 || slash === token.length - 1) {
    return undefined;
  }
  return [token.slice(0, slash), token.slice(slash + 1)];
}

/**
 * A slash-shaped token composed from its own registered parts: `"MB/s"`
 * resolves once `MB` and `s` are registered, with nobody having pre-declared
 * the rate as its own atom. `/s` falls out of the algebra this way rather
 * than being baked into a table entry per rung.
 *
 * Reuses {@link resolveComponent}'s own guard for the failure rather than
 * inventing a second error for the same mistake: a compound naming a
 * component nobody registered is exactly the typo `registerUnit`'s
 * `{ of, per }` form already refuses, so looking one up here is refused the
 * same way and for the same reason, loudly rather than rendering a nonsense
 * unit three screens later.
 */
function composeToken(
  token: string,
  parts: readonly [string, string],
): UnitDefinition {
  const [numeratorSymbol, denominatorSymbol] = parts;
  const numerator = resolveComponent(numeratorSymbol, token);
  const denominator = resolveComponent(denominatorSymbol, token);
  return {
    dim: Dim.divide(numerator.dim, denominator.dim),
    ratio: numerator.ratio / denominator.ratio,
    /** Informational only, since kind never gates arithmetic: reads the same way the rate atoms this replaces did, "science" to "scienceRate". */
    kind: `${numerator.kind}Rate`,
  };
}

export function lookupUnit(symbol: string): UnitDefinition | undefined {
  const direct = registry.get(symbol);
  if (direct) {
    return direct;
  }
  const parts = splitCompound(symbol);
  return parts ? composeToken(symbol, parts) : undefined;
}

/**
 * The declared unit a computed dimension should render as, or `undefined` when
 * nothing has been declared for it.
 *
 * A DECLARED name beats a natural composition: `force.times(distance).per(time)`
 * lands on `{kg:1, m:2, s:-3}` and renders `W`, not `kg·m²/s³`. Only ratio-1
 * units are eligible, because a computed value is in base units by
 * construction and rendering it as `kW` would be off by a thousand. First
 * registration wins, so a later `J/s` is an alias that parses but never
 * renders.
 */
export function declaredUnitFor(dimensionKey: string): string | undefined {
  return byDimension
    .get(dimensionKey)
    ?.find((symbol) => registry.get(symbol)?.ratio === 1);
}

function resolveComponent(symbol: string, registering: string): UnitDefinition {
  const definition = registry.get(symbol);
  if (!definition) {
    throw new Error(
      `Cannot register "${registering}": its component "${symbol}" is not a ` +
        "registered unit. Register it first, or declare the dimension " +
        "outright with { dimension }.",
    );
  }
  return definition;
}

function dimensionFor(registration: UnitRegistration): Dim.Dimension {
  const { symbol, dimension, of, per } = registration;
  if (dimension && (of || per)) {
    throw new Error(
      `Cannot register "${symbol}" with both an explicit dimension and ` +
        "components. Pick one.",
    );
  }
  if (dimension) {
    return dimension;
  }
  if (!of && !per) {
    throw new Error(
      `Cannot register "${symbol}": give it a dimension, or the components ` +
        "it is composed from.",
    );
  }
  const numerator = of ? resolveComponent(of, symbol).dim : {};
  const denominator = per ? resolveComponent(per, symbol).dim : {};
  return Dim.divide(numerator, denominator);
}

function sameDefinition(a: UnitDefinition, b: UnitDefinition): boolean {
  return (
    Dim.equal(a.dim, b.dim) &&
    a.ratio === b.ratio &&
    a.kind === b.kind &&
    a.log === b.log
  );
}

/**
 * Teaches the model a unit it did not ship with.
 *
 * The extension point for an Uplink, and for anything the first-party catalog
 * has no business naming. It is the only way a symbol gets a dimension, which
 * is what lets an unfamiliar value take part in arithmetic instead of merely
 * rendering.
 *
 * ## Overlap
 *
 * Two mods will sooner or later declare the same glyph, and the answer depends
 * on whether they disagree about anything that MATTERS:
 *
 * - **Identical declaration** is idempotent and silent. Two Uplinks declaring
 *   `u` as resource units are declaring the same thing.
 * - **Same dimension, different kind** is allowed and silent. `N·m` and `J` are
 *   the first-party example: same dimension, different meaning, and the
 *   difference is display's business rather than arithmetic's.
 * - **Anything else keeps the FIRST registration and warns.** It does not
 *   throw: a presentation disagreement between two mods is not a reason to
 *   break someone's install.
 *
 * That last rule covers the case the design originally wanted to allow
 * outright, and here is why it cannot. A `Value` carries a bare symbol and
 * nothing else, so if one `g` were grams and another `g` were g-force, there
 * would be no way to answer whether two `g` values can be added. Two
 * dimensions on one symbol makes `plus` unanswerable, so one of them has to
 * win. Screen ambiguity is a different problem with a different fix: the
 * spoken word in a tooltip, which does not need the registry's help.
 *
 * Our own ladder sidesteps the `g` case anyway (mass starts at `kg`), which is
 * why this is a policy for Uplinks rather than a live first-party concern.
 */
export function registerUnit(registration: UnitRegistration): void {
  const { symbol, kind, ratio = 1, log } = registration;
  if (!symbol) {
    throw new Error("Cannot register a unit with an empty symbol.");
  }
  if (!Number.isFinite(ratio) || ratio === 0) {
    throw new Error(
      `Cannot register "${symbol}" with a ratio of ${ratio}: it has to be a ` +
        "finite non-zero multiplier onto the dimension's base unit.",
    );
  }

  const dim = dimensionFor(registration);

  // Reserved symbols guard the UNNAMESPACED name only. `snacks:m` hijacks
  // nothing, so an Uplink is free to mean whatever it likes by it.
  const reserved = RESERVED.find((entry) => entry.symbol === symbol);
  if (reserved && !Dim.equal(reserved.dimension, dim)) {
    throw new Error(`Cannot register "${symbol}": ${reserved.why}`);
  }

  const definition: UnitDefinition = log
    ? { dim, ratio, kind, log }
    : { dim, ratio, kind };
  const existing = registry.get(symbol);
  if (!existing) {
    index(symbol, definition);
    return;
  }
  if (sameDefinition(existing, definition)) {
    return;
  }
  if (Dim.equal(existing.dim, definition.dim) && existing.ratio === ratio) {
    // Same quantity, different name for what it means. Both are true; kind is
    // display-only, so nothing downstream has to choose.
    return;
  }
  const conflictingDimension = !Dim.equal(existing.dim, definition.dim);
  console.warn(
    `Unit "${symbol}" is already registered as ` +
      `${Dim.formatDimension(existing.dim) || "dimensionless"} ` +
      `(${existing.kind}); keeping that and ignoring the new ` +
      `${Dim.formatDimension(dim) || "dimensionless"} (${kind}) declaration.` +
      (conflictingDimension
        ? ` NAMESPACE IT: declare "<yourmod>:${symbol}" instead. Until you do,` +
          ` any value carrying the bare "${symbol}" is read as` +
          ` ${existing.kind}, so two of them will ADD when they should not.` +
          " A value carries only its token, so one token cannot have two" +
          " dimensions and still answer whether two values can be combined."
        : ""),
  );
}
