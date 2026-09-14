import type { DeclaredUnit, UnitDeclarations } from "./declarations";
import { UNIT_DEFINITIONS, type UnitDefinition } from "./definitions";
import * as Dim from "./dimension";

/** One rung of a scaling ladder: a threshold in base units and its symbol. */
export interface UnitRung {
  /** Values at or above this magnitude (in base units) use this rung. */
  readonly from: number;
  readonly symbol: string;
  /** Divide the base value by this to get the rung's value. */
  readonly per: number;
}

/**
 * How a unit READS, which the model ignores and the kit applies. Every field is
 * optional, and a unit that sets none of them renders with its kind's defaults.
 */
export interface UnitPresentation {
  /** Decimal places on the scaled value, for every unit of this kind. */
  readonly decimals?: number;
  /** Render this kind in scientific notation by default, as `gravParameter` does. */
  readonly scientific?: true;
  /**
   * What to show beside the number for this kind, when it is not the symbol.
   * `""` for a token naming a category rather than a symbol, as `count` does.
   */
  readonly display?: string;
  /** What a screen reader says for the symbol: `megabytes` for `MB`. */
  readonly word?: string;
}

type DeclarationOf<S extends DeclaredUnit> = UnitDeclarations[S];

/**
 * The runtime half of a declared unit, typed from its declaration.
 *
 * Every field the declaration states is required here and must agree with it:
 * a `kind`, `dimension`, `ratio` or `ladder` different from the declared one is
 * a compile error, and so is a symbol nobody declared. The runtime cannot read a
 * type, so this is how the two are kept saying one thing.
 *
 * `rungs` is the only ladder fact the declaration does not carry, because a
 * rung is a display threshold rather than a unit. A registration naming a
 * ladder may supply them, and every unit on that ladder then climbs them.
 */
export type UnitRegistration<S extends DeclaredUnit = DeclaredUnit> = {
  readonly symbol: S;
  readonly kind: DeclarationOf<S>["kind"];
  readonly dimension: DeclarationOf<S> extends {
    dim: infer D extends Dim.Dimension;
  }
    ? D
    : never;
  readonly ratio: DeclarationOf<S>["ratio"];
  /** Logarithmic, so never prefix-scaled. */
  readonly log?: true;
} & (DeclarationOf<S> extends { ladder: infer L extends string }
  ? { readonly ladder: L; readonly rungs?: readonly UnitRung[] }
  : { readonly ladder?: never; readonly rungs?: never }) &
  UnitPresentation;

/**
 * A registration as the runtime holds it, with its types erased: what a
 * {@link onUnitRegistered} listener receives.
 */
export interface RegisteredUnit extends UnitPresentation {
  readonly symbol: string;
  readonly kind: string;
  readonly dimension: Dim.Dimension;
  readonly ratio: number;
  readonly log?: true;
  readonly ladder?: string;
  readonly rungs?: readonly UnitRung[];
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

type UnitListener = (unit: RegisteredUnit) => void;

const listeners = new Set<UnitListener>();

/**
 * Every registration the model accepted, in order, so a listener arriving after
 * an Uplink registered still hears about it.
 */
const accepted: RegisteredUnit[] = [];

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
  accepted.length = 0;
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
 * A component nobody registered makes the whole token unresolvable, and
 * {@link lookupUnit} turns that into "not a unit I know" rather than composing
 * a nonsense unit from half of one.
 */
function composeToken(
  parts: readonly [string, string],
): UnitDefinition | undefined {
  const [numeratorSymbol, denominatorSymbol] = parts;
  const numerator = registry.get(numeratorSymbol);
  const denominator = registry.get(denominatorSymbol);
  if (!numerator || !denominator) return undefined;
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
  if (!parts) {
    return undefined;
  }
  // A slash does not make a token a compound: `n/a` is a literal saying the
  // field has no unit at all, and there is no unit `n` divided by a unit `a`.
  // Composition is an OFFER here, so an unresolvable one means "not a unit I
  // know" and the value renders bare, exactly as an unrecognised token always
  // has.
  return composeToken(parts);
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

/**
 * The base unit a point-like unit's differences land in, or `undefined` when the
 * unit is not point-like.
 *
 * Reads the same `affineVector` declaration the type layer reads, through the
 * registry rather than the static table so a unit registered at runtime by an Uplink
 * gets the same answer. Ratio-1 only, for the reason `declaredUnitFor` gives: a
 * computed value is in base units by construction.
 */
export function affineVectorUnitFor(symbol: string): string | undefined {
  const definition = registry.get(symbol);
  const vectorKind = definition?.affineVector;
  if (!definition || vectorKind === undefined) return undefined;
  const key = Dim.key(definition.dim);
  return byDimension.get(key)?.find((candidate) => {
    const other = registry.get(candidate);
    return other?.kind === vectorKind && other.ratio === 1;
  });
}

function sameDefinition(a: UnitDefinition, b: UnitDefinition): boolean {
  return (
    Dim.equal(a.dim, b.dim) &&
    a.ratio === b.ratio &&
    a.kind === b.kind &&
    a.log === b.log &&
    a.ladder === b.ladder
  );
}

/**
 * Hears every unit {@link registerUnit} accepts, starting with the ones already
 * accepted.
 *
 * This is how the kit learns a unit's presentation from the one registration
 * call rather than from a second registry of its own. An Uplink has no reason
 * to call it.
 */
export function onUnitRegistered(listener: UnitListener): () => void {
  for (const unit of accepted) listener(unit);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Teaches the runtime a unit the type system already knows.
 *
 * The declaration in `UnitDeclarations` is what the compiler checks against; this
 * is what the running app reads, and its argument is typed from that declaration
 * so the two cannot say different things. A symbol nobody declared is a compile
 * error here, which is the point: a unit the runtime knows and the types do not
 * would render, and fall out of every check `<Unit>` makes.
 *
 * One call carries both halves. The model half (dimension, ratio) is what makes
 * values add up and what the payload decoder uses to recognise a quantity; the
 * presentation half (ladder rungs, decimals, the display symbol, the spoken word)
 * is forwarded to the kit through {@link onUnitRegistered}.
 *
 * ## Overlap
 *
 * Two mods will sooner or later declare the same glyph, and the answer depends
 * on whether they disagree about anything that MATTERS:
 *
 * - **Identical declaration** is idempotent and silent. Two Uplinks declaring
 *   `u` as resource units are declaring the same thing.
 * - **Same dimension and ratio, different kind or ladder** is allowed by the
 *   model, which never gates arithmetic on either. The kit refuses it, because
 *   which one renders would depend on module load order: that throws.
 * - **Anything else keeps the FIRST registration and warns.** It does not
 *   throw: a disagreement between two mods about what a symbol measures is not a
 *   reason to break someone's install.
 *
 * That last rule covers the case the design originally wanted to allow
 * outright, and here is why it cannot. A `Value` carries a bare symbol and
 * nothing else, so if one `g` were grams and another `g` were g-force, there
 * would be no way to answer whether two `g` values can be added. Two
 * dimensions on one symbol makes `plus` unanswerable, so one of them has to
 * win.
 *
 * Our own ladder sidesteps the `g` case anyway (mass starts at `kg`), which is
 * why this is a policy for Uplinks rather than a live first-party concern.
 */
export function registerUnit<S extends DeclaredUnit>(
  registration: UnitRegistration<S>,
): void {
  const unit: RegisteredUnit = registration;
  const { symbol, kind, ratio, log, ladder, rungs, dimension: dim } = unit;
  if (!symbol) {
    throw new Error("Cannot register a unit with an empty symbol.");
  }
  if (!Number.isFinite(ratio) || ratio === 0) {
    throw new Error(
      `Cannot register "${symbol}" with a ratio of ${ratio}: it has to be a ` +
        "finite non-zero multiplier onto the dimension's base unit.",
    );
  }
  if (!dim) {
    throw new Error(
      `Cannot register "${symbol}": give it the dimension its declaration states.`,
    );
  }
  if (rungs !== undefined && ladder === undefined) {
    throw new Error(
      `Cannot register "${symbol}" with rungs and no ladder: rungs belong to a ` +
        "ladder, and every unit naming that ladder climbs them.",
    );
  }

  // Reserved symbols guard the UNNAMESPACED name only. `snacks:m` hijacks
  // nothing, so an Uplink is free to mean whatever it likes by it.
  const reserved = RESERVED.find((entry) => entry.symbol === symbol);
  if (reserved && !Dim.equal(reserved.dimension, dim)) {
    throw new Error(`Cannot register "${symbol}": ${reserved.why}`);
  }

  const definition: UnitDefinition = {
    dim,
    ratio,
    kind,
    ...(log ? { log } : {}),
    ...(ladder === undefined ? {} : { ladder }),
  };
  const existing = registry.get(symbol);
  if (!existing) {
    index(symbol, definition);
    accept(unit);
    return;
  }
  if (
    sameDefinition(existing, definition) ||
    (Dim.equal(existing.dim, definition.dim) && existing.ratio === ratio)
  ) {
    // Same quantity. A differing kind or ladder is display's business, so the
    // model keeps what it has and the kit, which is where the two would render
    // differently, is the one that decides.
    accept(unit);
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

function accept(unit: RegisteredUnit): void {
  accepted.push(unit);
  for (const listener of listeners) listener(unit);
}
