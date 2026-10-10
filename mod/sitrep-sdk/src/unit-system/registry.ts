import type { DeclaredUnit, UnitDeclarations } from "./declarations";
import { UNIT_DEFINITIONS, type UnitDefinition } from "./definitions";
import * as Dim from "./dimension";

/**
 * One step of a unit ladder: the unit a value is shown in once it reaches a
 * size, such as `km` from 1,000 metres.
 *
 * @category Units and values
 */
export interface UnitRung {
  /** Values at or above this size, in the base unit, are shown on this rung. */
  readonly from: number;
  /** The symbol shown, such as `"km"`. */
  readonly symbol: string;
  /** The value in the base unit is divided by this to show it on this rung. */
  readonly per: number;
}

/**
 * How a unit is shown. Every field is optional, and a unit that sets none is
 * shown the way its kind is by default. Arithmetic ignores all of it.
 *
 * @category Units and values
 */
export interface UnitPresentation {
  /** Decimal places to show, for every unit of this kind. */
  readonly decimals?: number;
  /** Show this kind in scientific notation, as a gravitational parameter is. */
  readonly scientific?: true;
  /** What to show beside the number, when it is not the symbol. `""` shows nothing, as for `count`. */
  readonly display?: string;
  /** What a screen reader says for the symbol: `megabytes` for `MB`. */
  readonly word?: string;
}

type DeclarationOf<Unit extends DeclaredUnit> = UnitDeclarations[Unit];

/**
 * The argument to {@link registerUnit}: the unit's symbol, kind, dimension and
 * ratio, which must match its entry in {@link UnitDeclarations}, and how it is
 * shown. A symbol with no declaration, or a field that differs from it, does
 * not compile.
 *
 * `rungs` sets the steps of the unit's ladder, which the declaration does not
 * carry. Every unit on that ladder is then shown on those steps.
 *
 * @category Units and values
 */
export type UnitRegistration<Unit extends DeclaredUnit = DeclaredUnit> = {
  /** The token the unit is written as; it must have a declaration. */
  readonly symbol: Unit;
  /** The kind of quantity it measures, as its declaration says. */
  readonly kind: DeclarationOf<Unit>["kind"];
  /** Its dimension in base units, as its declaration says. */
  readonly dimension: DeclarationOf<Unit> extends {
    dim: infer Dimension extends Dim.Dimension;
  }
    ? Dimension
    : never;
  /** How many base units one of it is, as its declaration says. */
  readonly ratio: DeclarationOf<Unit>["ratio"];
  /** Set for a logarithmic unit, which is never shown on a ladder. */
  readonly log?: true;
} & (DeclarationOf<Unit> extends { ladder: infer Ladder extends string }
  ? { readonly ladder: Ladder; readonly rungs?: readonly UnitRung[] }
  : { readonly ladder?: never; readonly rungs?: never }) &
  UnitPresentation;

/**
 * A unit as {@link registerUnit} accepted it, without its declared types: what
 * an {@link onUnitRegistered} listener receives.
 *
 * @category Units and values
 */
export interface RegisteredUnit extends UnitPresentation {
  /** The token the unit is written as, including any namespace before a colon. */
  readonly symbol: string;
  /** The kind of quantity it measures, such as `"length"`. */
  readonly kind: string;
  /** Its dimension in base units. */
  readonly dimension: Dim.Dimension;
  /** How many base units one of it is. */
  readonly ratio: number;
  /** Set for a logarithmic unit, which is never shown on a ladder. */
  readonly log?: true;
  /** The ladder the unit belongs to, when it steps up and down with size. */
  readonly ladder?: string;
  /** The steps of that ladder, when the unit declares its own. */
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
 * Returns the symbol a unit is shown with: `"g"` for the unit `"snacks:g"`.
 * A unit may carry a namespace before a colon, so two mods can each have a
 * `g` that means different things; the namespace is never shown.
 *
 * @category Units and values
 */
export function displaySymbol(token: string): string {
  const colon = token.indexOf(":");
  return colon === -1 ? token : token.slice(colon + 1);
}

/**
 * Returns a unit's namespace, `"snacks"` for `"snacks:g"`, or `undefined` for
 * a unit with none.
 *
 * @category Units and values
 */
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

/**
 * Removes every unit registered with {@link registerUnit}, leaving Gonogo's
 * own. For tests.
 *
 * @category Units and values
 */
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

/**
 * Returns the definition of a unit, Gonogo's own or registered, or
 * `undefined` for a unit nothing defines. A rate such as `"kg/s"` is built
 * from its two parts when both are defined.
 *
 * @category Units and values
 */
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
 * Returns the unit a computed value of this dimension is shown in, or
 * `undefined` when none is declared. A force times a distance over a time is
 * shown as `W` rather than `kg·m²/s³`. Only a base unit is returned, never a
 * scaled one such as `kW`; where several share a dimension, the first
 * registered is used.
 *
 * @param dimensionKey - The dimension, as a key.
 *
 * @category Units and values
 */
export function declaredUnitFor(dimensionKey: string): string | undefined {
  return byDimension
    .get(dimensionKey)
    ?.find((symbol) => registry.get(symbol)?.ratio === 1);
}

/**
 * Returns the unit the difference of two values in an instant unit is in,
 * such as `"s"` for `"ut"`, or `undefined` for a unit that is not an instant.
 * See {@link PointUnit}.
 *
 * @category Units and values
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
 * Calls `listener` for every unit {@link registerUnit} accepts, starting with
 * those already accepted, and returns a function that unsubscribes. The kit
 * reads how to show each unit this way; an Uplink does not need it.
 *
 * @category Units and values
 */
export function onUnitRegistered(listener: UnitListener): () => void {
  for (const unit of accepted) listener(unit);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Registers a unit an Uplink declared, so values in it convert, combine and
 * show correctly. Declare the unit in {@link UnitDeclarations} first: the
 * registration is checked against that declaration, and a unit with none does
 * not compile.
 *
 * When two mods register the same symbol:
 *
 * - the same registration twice changes nothing
 * - the same dimension and ratio with a different kind or ladder throws, since
 *   which one is shown would depend on load order
 * - anything else keeps the first registration and logs a warning. To avoid
 *   the clash, give your unit a namespace, such as `"mymod:g"`; see
 *   {@link displaySymbol}
 *
 * The symbol `m` is reserved for metres and throws for any other dimension;
 * minutes are `min`.
 *
 * @category Units and values
 */
export function registerUnit<Unit extends DeclaredUnit>(
  registration: UnitRegistration<Unit>,
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

  // Reserved symbols guard the UNNAMESPACED name only. `snacks:m` hijacks nothing, so an Uplink is free to mean whatever it likes by it.
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
