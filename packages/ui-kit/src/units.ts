import {
  calendarRatio,
  type DeclaredUnit,
  onUnitRegistered,
  type RegisteredUnit,
  type UnitDeclarations,
  type UnitRung,
} from "@ksp-gonogo/sitrep-sdk";
import { GENERATED_UNIT_KINDS } from "./__generated__/unit-kinds";
import { formatKspDate } from "./formatKspDate";

/** A symbol the generated first-party table carries, for the runtime lookups. */
type GeneratedUnit = keyof typeof GENERATED_UNIT_KINDS;

/**
 * What the declaration says `S` measures, or `never` for a symbol nothing
 * declares.
 *
 * Every type in this module reads `UnitDeclarations` and nothing else, which is
 * what makes a unit an Uplink merges into it indistinguishable here from a
 * first-party one.
 */
type KindOfSymbol<S extends string> = S extends DeclaredUnit
  ? UnitDeclarations[S] extends { kind: infer K }
    ? K
    : never
  : never;

/** Every declared symbol that measures `K`. */
type SymbolsOfKind<K> = {
  [S in DeclaredUnit]: KindOfSymbol<S> extends K ? S : never;
}[DeclaredUnit];

/** The ladder `S` is declared on, or `never` for a unit that climbs none. */
type LadderOfSymbol<S extends string> = S extends DeclaredUnit
  ? UnitDeclarations[S] extends { ladder: infer L extends string }
    ? L
    : never
  : never;

/**
 * Every symbol of kind `K` that exists only as a conversion TARGET, which the
 * table above does not declare and {@link kindOfConversion} still resolves.
 *
 * `°C` is the whole of it today: the contract has no Celsius token on purpose,
 * so the only place the symbol is named is {@link CONVERSIONS}, and a type that
 * read the declarations alone would refuse the one conversion the kit ships a
 * readout for. A pair whose source is itself undeclared is skipped, or `°C→K`
 * would make every kind accept `K`.
 */
type ConversionTargetsOfKind<K> = {
  [P in keyof typeof CONVERSIONS]: P extends `${infer From}→${infer To}`
    ? [KindOfSymbol<From>] extends [never]
      ? never
      : [KindOfSymbol<From>] extends [K]
        ? To
        : never
    : never;
}[keyof typeof CONVERSIONS];

/**
 * Every unit that measures the same thing as `U`, which is exactly the set a
 * value in `U` may be re-expressed in.
 *
 * This is what makes `format="km/h"` check on a speed and fail on a length. It
 * is a mapped type over `UnitDeclarations`, so a unit declared there, by the
 * model or by an Uplink, widens the accepted set with nothing to keep in sync.
 *
 * A literal symbol nothing declares accepts no format at all: there is no kind
 * to check the request against, and a request that cannot be checked is the
 * wrong number under a right-looking label this module exists to prevent.
 * Declare the unit. Only a wide `string`, a unit this code chose not to track,
 * accepts any string.
 */
export type FormatsFor<U extends string> = string extends U
  ? string
  : FormatsForKind<KindOfSymbol<U>>;

/**
 * {@link FormatsFor}, asked of the KIND rather than of one of its units.
 *
 * A pin addressed to a whole group has no single unit to be checked against:
 * the group is the length ladder, not the metre. The kind is what both spellings
 * ultimately resolve to, so it is what the rule is written in terms of.
 */
export type FormatsForKind<K> = SymbolsOfKind<K>;

/**
 * Every unit a value in `U` may be SHOWN as, which is every unit of its kind
 * plus the presentation-only ones the conversion table reaches.
 *
 * Wider than {@link FormatsFor} by exactly the symbols that are not on the
 * wire. `format` pins a rung, so its answers have to be units the model
 * declares a ratio for; `as` re-expresses, so `°C` belongs to it and cannot
 * belong to the other. Both refuse a cross-kind request, which is the check
 * that matters: `as="kg"` on a length is still an error.
 */
export type PresentableAs<U extends string> = string extends U
  ? string
  : PresentableAsKind<KindOfSymbol<U>>;

/** {@link PresentableAs}, asked of the KIND. See {@link FormatsForKind}. */
export type PresentableAsKind<K> =
  | SymbolsOfKind<K>
  | ConversionTargetsOfKind<K>;

/**
 * How many of the kind's BASE unit one of `symbol` is worth.
 *
 * Three sources, in order, and none of them written by hand here. The LIVE
 * CALENDAR first, because `d`, `h`, `min` and `science/day` are sized by the
 * running game rather than by physics and codegen bakes stock Kerbin figures
 * for all four. Then the unit's declared ratio, then the rung's own divisor
 * for a rung the model has no unit for. Even the multiplicative conversions
 * (g to m/s², rad to degrees) come through as ordinary ratios.
 *
 * The calendar table lives in the SDK, not here, and duplicating it in this
 * file makes the kit's DISPLAY path follow the game while `Value` arithmetic
 * in the SDK does not, so a formatted duration and a computed one disagree.
 * One table, below both consumers.
 */
function ratioOf(symbol: string): number | undefined {
  const fromCalendar = calendarRatio(symbol);
  if (fromCalendar !== undefined) return fromCalendar;
  const declared = declarationOf(symbol);
  if (declared) return declared.ratio;
  const ladder = rungLadderOf(symbol);
  return ladder === undefined
    ? undefined
    : laddersByName[ladder]?.find((r) => r.symbol === symbol)?.per;
}

import { formatDuration, formatIrlDuration } from "./formatDuration";
import { NULL_DISPLAY } from "./NullValue";

/**
 * Unit-aware value formatting.
 *
 * The contract declares what a field IS (metres, m/s, kelvin) and this decides
 * how to SHOW it. That split is the whole design: the wire is canonical SI and
 * never pre-scaled, because a pre-scaled value cannot be graphed, diffed, or
 * re-scaled by a consumer that wants different units. Scaling is a presentation
 * decision, so it lives here.
 *
 * It exists because the formatting was duplicated. Eighteen widgets carried
 * unit literals, including two separate SI ladders written out longhand
 * (`Gm`/`Mm`/`km`/`m` in one file, `Yg`/`Zg`/`Eg`/`Pg` in another), and one of
 * those already carries a comment about a real gram-versus-kilogram prefix bug
 * found in it. One ladder per dimension, defined once, is the fix.
 *
 * Published, so a third-party Uplink formats its readouts exactly like a
 * first-party one.
 */

/**
 * What a unit measures. The kind is what makes the system checkable: it says
 * `m` and `km` are interchangeable and `m` and `m/s` are not, and it selects
 * the ladder and the precision rule.
 */
export type KnownQuantityKind =
  | "length"
  | "speed"
  | "acceleration"
  | "mass"
  | "force"
  | "pressure"
  | "temperature"
  | "time"
  // An INSTANT on the game's clock rather than a length of it. Same dimension
  // as `time` and a separate kind for the reason `<MissionDate>` gives in full:
  // 9,201,600 of these is not "106 days", it is Year 2 Day 1, so climbing the
  // time ladder renders a true statement about the wrong quantity. `<Unit>` is
  // not the component for it; `<MissionDate>` is, or subtract the frame's view
  // time and render the duration that leaves.
  | "universalTime"
  // An engine's specific impulse. Seconds by dimension and NOT a length of
  // time, which is why it is its own kind rather than an option on `time`: a
  // 320 s engine on the duration ladder reads "5min 20s", a true statement
  // about the wrong quantity, and it is the same trap `universalTime` above
  // exists for. It has no ladder, because an Isp is quoted as itself at every
  // magnitude an engine reaches.
  | "specificImpulse"
  // Time measured by a clock on the desk rather than by the game: how long
  // ago a reading arrived, how long a recorder ran. A day is 24 hours here
  // and 6 hours in `time`, which is why they are two kinds and not one.
  | "irlTime"
  | "planeAngle"
  | "power"
  // A quantity of data at rest: a file, a drive, a transmission buffer. Based
  // in bits like `dataRate` and kept a separate kind from it for the same
  // reason `length` and `speed` are separate: a drive and a downlink are not
  // interchangeable, and only one of them may be shown as the other.
  | "data"
  | "dataRate"
  | "doseRate"
  | "irradiance"
  | "level"
  | "density"
  // Propellant leaving the vessel per second. A separate kind from `resourceFlow`
  // for the reason `mass` and `resourceUnits` are separate: one is kilograms, the
  // other is whatever the tank counts in, and only one of them multiplies by an
  // exhaust velocity to give a thrust.
  | "massFlow"
  | "gravParameter"
  | "dimensionless"
  | "percent"
  | "scienceData"
  | "scienceRate"
  | "ratio"
  // Non-dimensional kinds. These say "this has no physical dimension", which
  // is a different claim from `dimensionless` ("a real measurement that
  // happens to have no unit", Mach and TWR) and a very different one from an
  // absent unit ("nobody said"). They exist so the contract can DECLARE the
  // non-quantities instead of skipping them, which is what makes a coverage
  // gate possible at all.
  | "area"
  | "volume"
  | "angularSpeed"
  | "funds"
  | "science"
  | "reputation"
  // The two currencies that can FLOW. A career overhaul turns reputation into
  // an income and levies a standing cost against it, so a balance and a rate
  // sit side by side and must not format the same way: a rate wants a decimal
  // where a balance does not.
  | "fundsRate"
  | "reputationRate"
  | "count"
  | "id"
  | "resourceUnits"
  | "resourceFlow"
  | "text"
  | "flag"
  | "enum"
  | "n/a";

/**
 * A quantity kind, OPEN to kinds this package has never heard of.
 *
 * The `string & {}` arm is what lets a third-party Uplink introduce its own
 * dimension (a resource rate, a mod's bespoke scale) while the known kinds
 * still autocomplete. Closing this union would have made
 * `registerUnit({ kind: "resourceRate" })` a type error, and "third parties
 * are first-class" is a principle of this design rather than a nicety.
 */
export type QuantityKind = KnownQuantityKind | (string & {});

/** One rung of a scaling ladder: a threshold in base units and its symbol. */
export type Rung = UnitRung;

/**
 * Ladders, ascending. A dimension with no entry never scales, which is the
 * right default: scaling is the exception, not the rule.
 *
 * Deliberately absent:
 *  - `speed`, because delta-v and surface speed are read in m/s universally and
 *    "3.4 km/s" in a burn plan is correct and useless. A caller that genuinely
 *    wants a scaled speed asks for it.
 *  - `temperature`, because kelvin has no prefix convention in this domain, and
 *    a Celsius display is an OFFSET conversion, which a multiplicative ladder
 *    cannot express. It is a presentation unit instead: see `as`.
 *  - `time`, which does not climb by thousands. It has its own composite
 *    formatter, wired in below.
 *  - `gravParameter`, whose values are ~1e12 and have no named
 *    prefixes anyone uses. Scientific notation instead: see `SCIENTIFIC`.
 *  - `planeAngle`, `ratio`, `dimensionless`, which have no magnitudes to climb.
 */
// Exported (rather than kept module-private like the tables around it) so
// `unit-symbol-collision.test.ts` can walk every declared rung symbol
// directly, the same source `formatQuantity` itself reads, instead of a
// second hand-copied list that could silently drift from this one.
export const LADDERS = {
  length: [
    { from: 0, symbol: "m", per: 1 },
    { from: 1e3, symbol: "km", per: 1e3 },
    { from: 1e6, symbol: "Mm", per: 1e6 },
    { from: 1e9, symbol: "Gm", per: 1e9 },
    // Out of reach in the stock system (Eeloo's apoapsis is ~114 Gm) and even
    // in the usual planet packs, but core's hand-rolled `formatDistance`
    // carried a Tm rung and eight widgets read through it. Keeping the rung
    // means the migration is a pure delegation rather than a silent ceiling at
    // "1500.0 Gm" for anyone running an outer-planets install.
    { from: 1e12, symbol: "Tm", per: 1e12 },
  ],
  // Every threshold and divisor here is in KILOGRAMS, including the
  // astronomical rungs, whose symbols are gram-based (1 Yg is 1e24 g, so
  // 1e21 kg). Stating them in kg is not a convenience, it makes a real bug
  // unrepresentable: SystemView's hand-rolled version applied gram thresholds
  // straight to a kilogram value and labelled Kerbin's 5.29e22 kg as
  // "52.91 Zg", one whole prefix tier too small. A single base unit per
  // ladder means that mistake has nowhere to live.
  mass: [
    { from: 0, symbol: "kg", per: 1 },
    { from: 1e3, symbol: "t", per: 1e3 },
    { from: 1e6, symbol: "kt", per: 1e6 },
    { from: 1e9, symbol: "Tg", per: 1e9 },
    { from: 1e12, symbol: "Pg", per: 1e12 },
    { from: 1e15, symbol: "Eg", per: 1e15 },
    { from: 1e18, symbol: "Zg", per: 1e18 },
    { from: 1e21, symbol: "Yg", per: 1e21 },
  ],
  force: [
    { from: 0, symbol: "N", per: 1 },
    { from: 1e3, symbol: "kN", per: 1e3 },
    { from: 1e6, symbol: "MN", per: 1e6 },
  ],
  // Descends below the base unit, as density does. Upper
  // atmosphere runs to fractions of a pascal, and AtmosphereProfile's
  // hand-rolled version already carried an mPa rung for exactly that; the
  // shared ladder has to cover it or migrating that widget would lose a real
  // reading at altitude.
  pressure: [
    { from: 0, symbol: "mPa", per: 1e-3 },
    { from: 1, symbol: "Pa", per: 1 },
    { from: 1e3, symbol: "kPa", per: 1e3 },
    { from: 1e6, symbol: "MPa", per: 1e6 },
  ],
  // The byte family on a BIT base, and the base is the whole point. A drive or
  // a science file arrives in MB, an antenna budget in bit/s, and basing this
  // ladder in bytes would leave the two as incommensurable islands; basing it
  // in bits makes one a rung of the other. The rungs are still bytes, because
  // nobody reads a drive in bits.
  //
  // Decimal throughout: 1 KB is 8e3 bit, not 8×1024. That matches `dataRate`'s
  // own kbit/s below, and it matches the 8e6 an Uplink dimensions `MB` onto
  // `bit` at, which is the only reason a value it publishes lands on the right
  // rung here. The binary powers are a different family with different symbols
  // (KiB, MiB), and there is deliberately no rung here that could start the
  // 2.4%-per-tier drift between them.
  //
  // The `bit` rung at the bottom is not decoration. Without it the lowest rung
  // is `B`, and a sub-byte reading renders as a fraction of a byte, which is
  // both unreadable and a claim about precision the source never made.
  data: [
    { from: 0, symbol: "bit", per: 1 },
    { from: 8, symbol: "B", per: 8 },
    { from: 8e3, symbol: "KB", per: 8e3 },
    { from: 8e6, symbol: "MB", per: 8e6 },
    { from: 8e9, symbol: "GB", per: 8e9 },
  ],
  /**
   * The BIT-family rate rungs. Bits and bytes share a dimension but never
   * share rungs, so a rate arriving in a byte unit climbs `dataRateBytes`
   * below instead: `0.004 MB/s` reads `4 kB/s`, never `32 kbit/s`. Which of
   * the two a value gets is decided by its declared unit, see `ladderFor`.
   */
  dataRate: [
    { from: 0, symbol: "bit/s", per: 1 },
    { from: 1e3, symbol: "kbit/s", per: 1e3 },
    { from: 1e6, symbol: "Mbit/s", per: 1e6 },
    { from: 1e9, symbol: "Gbit/s", per: 1e9 },
  ],
  // Based in watts even though nothing on the wire is: the contract declares
  // kW because that is what KSP's thermal API hands out, and the normalise-to-
  // base step above turns that into the right rung. Basing the ladder in kW
  // instead would work until the first field that arrives in plain watts.
  //
  // The MW rung is load-bearing, not decorative. A reentry heat shield runs to
  // several thousand kW, and ThermalStatus's hand-rolled formatter carried an
  // MW rung for exactly that; without one here, migrating it would render peak
  // reentry flux as a four-digit kW number.
  power: [
    { from: 0, symbol: "W", per: 1 },
    { from: 1e3, symbol: "kW", per: 1e3 },
    { from: 1e6, symbol: "MW", per: 1e6 },
    { from: 1e9, symbol: "GW", per: 1e9 },
  ],
  // A single always-on rung rather than a real multi-step ladder: the wire's
  // base unit (rad/s) is unreadable at the magnitudes dose rates actually
  // occupy (typically 1e-6..1e-2 rad/s), and radiation readouts are
  // conventionally shown in rad/h. Laddering it here lets
  // `<Unit value={someRadPerSecond} />` render "X rad/h" directly, with no
  // per-call-site conversion.
  doseRate: [{ from: 0, symbol: "rad/h", per: 1 / 3600 }],
  // Based in kg/m³ with a gram rung beneath it: sea-level air is about one
  // kilogram per cubic metre, and the upper atmosphere is read in grams.
  density: [
    { from: 0, symbol: "g/m³", per: 1e-3 },
    { from: 1, symbol: "kg/m³", per: 1 },
  ],
} satisfies Record<string, readonly Rung[]>;

/**
 * Every ladder by name: the first-party ones above, each named for the kind it
 * scales, and every one a registration has supplied rungs for since.
 *
 * `satisfies` above keeps the literal keys so a type test can hold them to the
 * ladder names the declarations state; the lookups here are by a name that
 * arrives as a plain string, including one an Uplink registered after this
 * module loaded.
 */
const laddersByName: Record<string, readonly Rung[]> = { ...LADDERS };

/**
 * Every ladder a declared unit names, and therefore every group that settles
 * one rung together. A unit on none of them is a group of its own: `m`, `km`
 * and `Mm` are one group and `s` and `min` are two.
 */
export type LadderName = {
  [S in DeclaredUnit]: LadderOfSymbol<S>;
}[DeclaredUnit];

/**
 * What a pin may be addressed to: one GROUP, named the way the group is formed.
 *
 * A unit on a ladder is named by the ladder, because every unit of it settles
 * together and `m`, `km` and `Mm` are one thing to pin. Everything else is named
 * by the unit, because nothing interconverts it with its siblings and a pin on
 * `s` says nothing about `min`.
 *
 * Keying the record this way is what makes "a group is pinned at most once" a
 * property of the type rather than a rule the runtime resolves silently: under a
 * unit-keyed record `{ m: ..., km: ... }` was one group pinned twice, and the
 * later entry quietly won.
 *
 * Read off `UnitDeclarations`, so a ladder an Uplink declares is a key on
 * exactly the terms `length` is, and the runtime groups by the same declaration.
 */
export type UnitGroupKey =
  | LadderName
  | {
      [S in DeclaredUnit]: [LadderOfSymbol<S>] extends [never] ? S : never;
    }[DeclaredUnit];

/**
 * What the group named by `G` measures, so a pin addressed to it can be checked.
 *
 * A ladder key measures whatever its units do; a unit key resolves through the
 * declarations the same way a lone `<Unit>` does.
 */
export type KindOfGroup<G extends UnitGroupKey> = G extends LadderName
  ? {
      [S in DeclaredUnit]: [LadderOfSymbol<S>] extends [G]
        ? [LadderOfSymbol<S>] extends [never]
          ? never
          : KindOfSymbol<S>
        : never;
    }[DeclaredUnit]
  : KindOfSymbol<G>;

/**
 * Kinds that render in scientific notation when nothing says otherwise.
 *
 * A ladder is the wrong tool for a quantity whose exponent is both huge and
 * unnamed. Kerbin's gravitational parameter is 3.5316e12 m³/s²: there is no
 * conventional prefix for it, "3531600000000" is unreadable, and "3.53 Tm³/s²"
 * is a unit nobody writes. Scientific notation is what the astrodynamics
 * literature actually uses, so it is what a reader recognises.
 */
const SCIENTIFIC = new Set<string>(["gravParameter"]);

/** Significant figures in a scientific mantissa, unless the caller overrides. */
const SCIENTIFIC_SIGNIFICANT = 4;

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "-": "⁻",
};

/**
 * `3.532×10¹²`, not `3.532e12`.
 *
 * Real superscript digits rather than the `e` form because this is a readout, not
 * a REPL: `e12` is programmer notation and reads as part of the number to
 * everyone else. Unicode superscripts need no markup, so the result stays a
 * plain string that a caller can put in an axis label or an `aria-label`.
 */
function toScientific(value: number, significant: number): string {
  if (value === 0) return "0";
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const mantissa = value / 10 ** exponent;
  // `significant` counts digits, and the mantissa always has exactly one before
  // the point, so the rest are decimals.
  const digits = String(exponent)
    .split("")
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join("");
  return `${mantissa.toFixed(Math.max(0, significant - 1))}×10${digits}`;
}

/**
 * Standard gravity, the SI definition. KSP agrees: `PhysicsGlobals.
 * GravitationalAcceleration` is a single global constant rather than a per-body
 * value, and Kerbin's own surface gravity (mu/r² = 3.5316e12 / 600000²) comes
 * out at 9.81 m/s², so "one gee" and "one Kerbin gee" are the same number and
 * the ambiguity is unobservable in-game.
 */
export { STANDARD_GRAVITY } from "@ksp-gonogo/sitrep-sdk";

import { STANDARD_GRAVITY } from "@ksp-gonogo/sitrep-sdk";

/**
 * Presentation conversions: what a value may be SHOWN as, given what it IS.
 *
 * The wire is canonical SI and stays that way; an operator who wants Celsius or
 * gees is making a display choice, and a display choice belongs here rather than
 * in the contract. Keyed source→target, `target = value / per + offset`, which
 * covers the offset conversions (kelvin) that a ladder structurally cannot.
 *
 * Only within a kind. Converting a length to a mass is not a preference, it is a
 * bug, and `formatQuantity` refuses it rather than inventing a number.
 *
 * `as const` is load-bearing, the same way the generated table's is:
 * {@link PresentableAs} reads the pair KEYS to learn that `°C` is a
 * temperature, and an annotated `Record<string, ...>` would erase them and
 * silently stop typing the one conversion with a readout behind it.
 */
const CONVERSIONS = {
  "K→°C": { per: 1, offset: -273.15 },
  "°C→K": { per: 1, offset: 273.15 },
  "m/s²→g": { per: STANDARD_GRAVITY, offset: 0 },
  "g→m/s²": { per: 1 / STANDARD_GRAVITY, offset: 0 },
  "rad→°": { per: Math.PI / 180, offset: 0 },
  "°→rad": { per: 180 / Math.PI, offset: 0 },
} as const satisfies Record<string, { per: number; offset: number }>;

/**
 * The same table, reached by a key built at runtime, which an `as const` one
 * cannot be indexed by.
 */
const CONVERSION_BY_PAIR: Record<string, { per: number; offset: number }> =
  CONVERSIONS;

/**
 * How much precision a kind is read at, as decimal places on the SCALED value.
 *
 * Per kind rather than per magnitude, so a readout holds a stable digit count
 * as the value moves. An instrument whose width changes every frame reads as a
 * fault, which is also why anything live should render in tabular numerals.
 */
const DECIMALS: Record<string, number> = {
  length: 1,
  speed: 1,
  acceleration: 2,
  mass: 2,
  force: 1,
  pressure: 2,
  temperature: 0,
  time: 0,
  irlTime: 0,
  // Integral: the game and every engine chart quote an Isp whole, and the
  // fractional digit is below what a plan is tuned on.
  specificImpulse: 0,
  planeAngle: 2,
  density: 4,
  // Two decimals: a small RCS burn runs at a fraction of a kilogram a second,
  // and rounding that to zero reads as an engine that is not consuming anything.
  massFlow: 2,
  // One decimal on the byte ladder: a drive reads "1.4 GB" and a file
  // "12.5 MB", and the rung changes before the digit count has to.
  data: 1,
  dataRate: 1,
  // One decimal reads right at the kW rung a flux readout mostly sits at
  // (`842.3 kW`), and stays legible at MW (`2.4 MW`).
  power: 1,
  doseRate: 4,
  irradiance: 1,
  level: 1,
  dimensionless: 2,
  percent: 1,
  scienceData: 1,
  scienceRate: 1,
  ratio: 0,
  // A count is integral: "3.00 crew" is wrong in a way "3.00 Mach" is not,
  // which is the whole reason `count` is a separate kind from `dimensionless`.
  count: 0,
  id: 0,
  resourceUnits: 1,
  resourceFlow: 2,
  area: 1,
  volume: 1,
  angularSpeed: 0,
  // Currencies are whole numbers. KSP never pays out a fraction of a fund,
  // and a reputation reading with two decimals implies a precision the game
  // does not have.
  funds: 0,
  science: 1,
  reputation: 1,
  // The rates take a decimal where their balances take none. A daily upkeep of
  // 980.4 funds is a real distinction from 980, and a reputation decaying by
  // 0.11 a day rounds to nothing without one.
  fundsRate: 1,
  reputationRate: 2,
};

/**
 * What to SHOW beside the number, when it differs from the token the wire
 * carries.
 *
 * The catalog's rule is that a token is the operator-facing symbol, so a
 * formatter with no special case can append it verbatim and still be right.
 * The non-dimensional tokens deliberately break that rule: they name a
 * CATEGORY, not a symbol, and "12 count" or "3 id" is not a readout. They
 * render with no symbol at all, and the cost of the exception is paid here, in
 * one table, rather than at every call site.
 *
 * `ratio` and `time` already showed the same thing is needed for real units
 * (they display as `%` and as an interleaved duration), but both carry extra
 * behaviour beyond the label and keep their own branches below.
 */
const DISPLAY_BY_KIND: Record<string, string> = {
  // The currencies name a category, not a symbol, so each gets the short form
  // the dashboard already uses ("289,848f" in the funds readouts, "13.97 rep"
  // in Strategies). These are the TEXT fallbacks; §3 of the UI goal replaces
  // them with a flask and a star, at which point they become the alt text.
  funds: "f",
  science: "sci",
  reputation: "rep",
  // The contract's token is `Mit`; the game, and every science readout on
  // this dashboard, writes "mits". The token is what the wire says and this
  // is what an operator reads.
  scienceData: "mits",
  // An Isp reads in seconds and always has. The kind exists to keep it off the
  // duration ladder, not to change what an operator sees beside the number.
  specificImpulse: "s",
  count: "",
  id: "",
  text: "",
  flag: "",
  enum: "",
  "n/a": "",
};

/**
 * What `registerUnit` taught the kit about each Uplink unit, layered over the
 * generated first-party table. Empty until an Uplink registers something.
 *
 * There is deliberately no hand-written first-party table here. ui-kit kept one
 * beside the SDK's for as long as both existed, and they drifted: seven units
 * disagreed on what their kind was CALLED.
 */
interface UnitFacts {
  readonly kind: QuantityKind;
  readonly ratio: number;
  readonly ladder?: string;
}

const REGISTERED_UNITS: Record<string, UnitFacts> = {};

/** The kind every ladder scales, by ladder name. */
const LADDER_KINDS: Record<string, QuantityKind> = Object.fromEntries(
  Object.keys(LADDERS).map((name) => [name, name]),
);

/** The declaration a symbol has, registered or first-party, if it has one. */
function declarationOf(symbol: string): UnitFacts | undefined {
  return (
    REGISTERED_UNITS[symbol] ?? GENERATED_UNIT_KINDS[symbol as GeneratedUnit]
  );
}

/**
 * The ladder a symbol climbs within, by name.
 *
 * A declared unit climbs exactly the ladder its declaration names, and none if
 * it names none, whatever its kind: that is the rule `UnitGroupKey` states, and
 * the two must agree. Bits and bytes are both `data` and must never interleave,
 * which is why the ladder is a name a unit declares rather than a property of
 * its kind. A symbol with no declaration is a rung, and climbs the ladder that
 * lists it.
 */
function ladderNameOf(symbol: string | undefined): string | undefined {
  if (symbol === undefined) return undefined;
  const declared = declarationOf(symbol);
  if (declared) return declared.ladder;
  return rungLadderOf(symbol);
}

/** The rungs a value climbs. A unit on no ladder never scales. */
function ladderForUnit(unit: string | undefined): readonly Rung[] | undefined {
  const name = ladderNameOf(unit);
  return name === undefined ? undefined : laddersByName[name];
}

/**
 * A rung is not a unit. `Mbit/s` and `kt` never appear in the contract and have
 * no entry in the model, but a formatter handed one back still has to know what
 * it measures. The ladder it belongs to already says, so the answer is derived
 * rather than stored: another table would be another thing to drift.
 *
 * Built lazily and rebuilt whenever a registration supplies a ladder.
 */
let rungLadders: Record<string, string> | undefined;

function rungLadderOf(symbol: string): string | undefined {
  if (rungLadders === undefined) {
    rungLadders = {};
    for (const [name, rungs] of Object.entries(laddersByName)) {
      for (const rung of rungs) {
        // First ladder wins, so a base symbol shared with the model keeps the
        // model's answer rather than a ladder's.
        rungLadders[rung.symbol] ??= name;
      }
    }
  }
  return rungLadders[symbol];
}

function kindOfRung(symbol: string): QuantityKind | undefined {
  const name = rungLadderOf(symbol);
  return name === undefined ? undefined : LADDER_KINDS[name];
}

/**
 * A presentation-only unit reached by conversion rather than by the wire.
 * `°C` is the whole of it: the contract deliberately has no Celsius token, so
 * the only place `°C` is named is the conversion table, and that is enough to
 * say it is a temperature.
 */
function kindOfConversion(symbol: string): QuantityKind | undefined {
  for (const pair of Object.keys(CONVERSIONS)) {
    const [from, to] = pair.split("\u2192");
    if (to === symbol) {
      return declarationOf(from)?.kind ?? kindOfRung(from);
    }
  }
  return undefined;
}

/**
 * What each displayed symbol is CALLED, for the accessibility tree.
 *
 * A symbol is written for the eye and read badly by everything else: a screen
 * reader announces `km` as "kay em", and `°` as nothing whatsoever, so a
 * degrees readout announces as a bare number. An icon is worse still, since it
 * is `aria-hidden` twice over.
 *
 * Keyed on the DISPLAYED symbol rather than the wire token, because that is
 * what a reader actually meets: the currencies display as `f`/`sci`/`rep`, and
 * a laddered value displays as whichever rung it climbed to, so `km` and `Mm`
 * need their own entries rather than inheriting one from `m`.
 *
 * There is no exception list for "symbols that read well enough". `km` is
 * decodable where `°` is not, but an exception list is the thing that rots,
 * and the map is the same map either way.
 */
const WORD_BY_SYMBOL: Record<string, string> = {
  // Length, and its rungs.
  m: "metres",
  km: "kilometres",
  Mm: "megametres",
  Gm: "gigametres",
  Tm: "terametres",
  // Mass. The astronomical rungs are gram-based symbols on a kilogram ladder,
  // which is exactly why saying them out loud is worth doing.
  kg: "kilograms",
  t: "tonnes",
  kt: "kilotonnes",
  Tg: "teragrams",
  Pg: "petagrams",
  Eg: "exagrams",
  Zg: "zettagrams",
  Yg: "yottagrams",
  // Force.
  N: "newtons",
  kN: "kilonewtons",
  MN: "meganewtons",
  // Pressure.
  mPa: "millipascals",
  Pa: "pascals",
  kPa: "kilopascals",
  MPa: "megapascals",
  // Rates.
  W: "watts",
  kW: "kilowatts",
  MW: "megawatts",
  GW: "gigawatts",
  "bit/s": "bits per second",
  "kbit/s": "kilobits per second",
  "Mbit/s": "megabits per second",
  "Gbit/s": "gigabits per second",
  // Data at rest. `B` is the worst of the set out loud: a screen reader
  // announces it as the letter, so "4 B" and "4 bee" are the same utterance.
  bit: "bits",
  B: "bytes",
  KB: "kilobytes",
  MB: "megabytes",
  GB: "gigabytes",
  // Motion.
  "m/s": "metres per second",
  "m/s\u00B2": "metres per second squared",
  g: "gee",
  rpm: "revolutions per minute",
  // Angle. These announce as nothing at all without a word.
  "\u00B0": "degrees",
  "\u2032": "arcminutes",
  "\u2033": "arcseconds",
  rad: "radians",
  // Temperature. `K` announces as the letter, `\u00B0C` as "cee".
  K: "kelvin",
  "\u00B0C": "degrees celsius",
  // Everything else the contract declares.
  s: "seconds",
  min: "minutes",
  h: "hours",
  dB: "decibels",
  "rad/s": "radians per second",
  "W/m\u00B2": "watts per square metre",
  "g/m\u00B3": "grams per cubic metre",
  "kg/m\u00B3": "kilograms per cubic metre",
  "m\u00B3/s\u00B2": "cubic metres per second squared",
  "m\u00B2": "square metres",
  "m\u00B3": "cubic metres",
  "%": "percent",
  Mit: "mits",
  "science/day": "science per day",
  "f/day": "funds per day",
  "rep/day": "reputation per day",
  units: "units",
  "units/s": "units per second",
  // The currencies, as displayed. `f` is a letter and `sci`/`rep` are
  // abbreviations; none of the three says what it is out loud, and `sci` and
  // `rep` are rendered as icons, which say nothing at all.
  f: "funds",
  sci: "science",
  rep: "reputation",
};

/**
 * What a displayed symbol is called, or undefined for one with no word (the
 * category kinds display as an empty string and have nothing to announce).
 */
export function wordForSymbol(symbol: string): string | undefined {
  return WORD_BY_SYMBOL[symbol];
}

/**
 * A quantity as a screen reader should hear it: the value followed by the
 * unit's WORD rather than its symbol.
 *
 * **The one sanctioned way to get a quantity as a string**, and it is narrow on
 * purpose. `<Unit>` is how a quantity is SHOWN; this is for the places that
 * cannot take a node at all, which in practice means `aria-label`, `title`, and
 * an SVG `aria-valuetext`. Those are also exactly the places a symbol is worst:
 * an accessible name built by interpolating a formatted string announces "two
 * fifty point zero kay em", and this is what makes it "250.0 kilometres".
 *
 * If the result is going to be rendered, this is the wrong function. The
 * guard in `styleguide-unit-adoption.test.ts` is what keeps that honest.
 *
 * Falls back to the symbol for a unit with no word, the same rule `Unit`
 * follows.
 */
export function speakQuantity(
  quantity: { magnitude: number; unit: string } | null | undefined,
  opts: FormatQuantityOptions = {},
): string {
  const { value: text, symbol } = formatQuantity(
    quantity?.magnitude,
    quantity?.unit,
    opts,
  );
  if (symbol === "") return text;
  return `${text} ${wordForSymbol(symbol) ?? symbol}`;
}

/**
 * The symbols written hard against the number, for two unrelated reasons.
 *
 * **Plane angle**, because SI says so: `22°`, not `22 °`. Degree, arcminute,
 * arcsecond, and deliberately NOT the degree-Celsius pair, which takes the
 * normal space.
 *
 * **Currency and its neighbours**, because SI does not govern them. A
 * currency mark is typography rather than a unit symbol, and every convention
 * writes it tight: `£5`, `5p`, and KSP's own `√42,500`. This app has shown
 * `42,500f` since it had a funds readout, CLAUDE.md's spend-the-balance rule
 * spells it that way, and the science and reputation marks sit beside it in
 * the same rows. A space here would be a visible change with nothing behind
 * it but a rule that does not apply.
 *
 * Lives here rather than in `Unit` because BOTH ways of showing a quantity
 * have to agree on it. They did not: the component attached the degree sign
 * and `writeQuantity` always inserted a space, so the same angle read `8.0°`
 * in a readout and `8.0 °` in the SVG label beside it.
 */
export const ATTACHED_SYMBOLS: ReadonlySet<string> = new Set([
  "°",
  "′",
  "″",
  "f",
  "sci",
  "rep",
]);

/**
 * A quantity as it is WRITTEN: the value and the unit's symbol, `250.0 km`.
 *
 * The other half of the pair above, for the places that cannot take a node
 * AND are read with the eyes rather than heard: an SVG `<text>` (which cannot
 * contain a `<span>`, so `<Unit>` will not go in one), a canvas label, a chart
 * annotation whose width is measured before it is drawn.
 *
 * Use `speakQuantity` for an accessible name and this for visible text; both
 * are narrow escapes from `<Unit>`, and anywhere a node fits, neither applies.
 *
 * An ordinary space, not the thin space `<Unit>` sets: this string ends up in
 * an SVG `<text>`, a canvas, or an attribute, where a U+2009 is at the mercy
 * of the renderer and is a trap in a test expectation besides.
 */
export function writeQuantity(
  quantity: { magnitude: number; unit: string } | null | undefined,
  opts: FormatQuantityOptions = {},
): string {
  const { value: text, symbol } = formatQuantity(
    quantity?.magnitude,
    quantity?.unit,
    opts,
  );
  if (symbol === "") return text;
  return ATTACHED_SYMBOLS.has(symbol)
    ? `${text}${symbol}`
    : `${text} ${symbol}`;
}

/**
 * The symbol shown beside a value: the kind's display override if it has one,
 * otherwise the token itself.
 */
export function displaySymbol(
  unit: string,
  kind: QuantityKind | undefined,
): string {
  return kind === undefined ? unit : (DISPLAY_BY_KIND[kind] ?? unit);
}

/**
 * What a unit symbol measures, or undefined for one we do not know.
 *
 * Three sources, in order, and NONE of them is a hand-written table in this
 * package: the unit's declaration (an Uplink's registration, or the generated
 * first-party table), then the ladder a rung belongs to, then the conversion
 * that names it.
 */
export function kindOfUnit(
  symbol: string | undefined,
): QuantityKind | undefined {
  if (symbol === undefined) return undefined;
  return (
    declarationOf(symbol)?.kind ??
    kindOfRung(symbol) ??
    kindOfConversion(symbol)
  );
}

function sameRungs(a: readonly Rung[], b: readonly Rung[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (rung, i) =>
        rung.from === b[i].from &&
        rung.symbol === b[i].symbol &&
        rung.per === b[i].per,
    )
  );
}

/**
 * Applies what one `registerUnit` call says about how a unit READS.
 *
 * Called for every registration the SDK's model accepts, including the ones made
 * before this module loaded, so there is one registration call and this kit
 * holds no registry an Uplink writes to directly.
 *
 * Two registrations of one symbol must mean the same thing by it, and two
 * registrations of one ladder must climb the same rungs: a value that renders
 * one way or another depending on which Uplink loaded last is worse than either,
 * so a disagreement throws. Identical registrations are a no-op, which is what
 * lets two Uplinks that never met share a ladder such as `bytes`.
 */
function applyRegisteredUnit(unit: RegisteredUnit): void {
  const { symbol, kind, ratio, ladder, rungs } = unit;
  const prior = declarationOf(symbol);
  if (prior && (prior.kind !== kind || prior.ladder !== ladder)) {
    throw new Error(
      `Unit "${symbol}" is already declared as ${prior.kind}` +
        `${prior.ladder ? ` (ladder ${prior.ladder})` : ""} and cannot be ` +
        `registered as ${kind}${ladder ? ` (ladder ${ladder})` : ""}. ` +
        "Two mods declaring the same symbol must mean the same thing by it: " +
        "a value would otherwise render differently depending on which loaded last.",
    );
  }
  if (ladder !== undefined) {
    const ladderKind = LADDER_KINDS[ladder];
    if (ladderKind !== undefined && ladderKind !== kind) {
      throw new Error(
        `Unit "${symbol}" names the ${ladder} ladder, which scales ${ladderKind}, ` +
          `not ${kind}. Every unit on one ladder measures one kind.`,
      );
    }
    const existing = laddersByName[ladder];
    if (rungs !== undefined && existing && !sameRungs(existing, rungs)) {
      throw new Error(
        `The ${ladder} ladder already has rungs, and "${symbol}" registers ` +
          "different ones. Two registrations of one ladder must climb the same rungs.",
      );
    }
    LADDER_KINDS[ladder] = kind;
    if (rungs !== undefined && !existing) {
      laddersByName[ladder] = rungs;
      // A new ladder brings rung symbols the cached index does not hold.
      rungLadders = undefined;
    }
  }
  REGISTERED_UNITS[symbol] =
    ladder === undefined ? { kind, ratio } : { kind, ratio, ladder };
  if (unit.decimals !== undefined) DECIMALS[kind] = unit.decimals;
  if (unit.scientific) SCIENTIFIC.add(kind);
  if (unit.display !== undefined) DISPLAY_BY_KIND[kind] = unit.display;
  if (unit.word !== undefined) WORD_BY_SYMBOL[symbol] = unit.word;
}

export interface FormatQuantityOptions {
  /**
   * Pin the unit rather than letting the ladder choose.
   *
   * The ladder is right by default: a distance climbs to km when it earns it,
   * and a readout that jumps between rungs is doing what an operator expects.
   * `format` is for the cases where convention beats magnitude. Orbital
   * velocity is read in km/s in technical contexts and m/s everywhere else,
   * and a launch broadcast quotes km/h for a lay audience: none of that
   * follows from how big the number is.
   *
   * Typed by KIND, so `format="km/h"` checks on a speed and is an error on a
   * length. Any unit of the same kind is accepted, including ones the ladder
   * would never pick on its own, which is the point.
   */
  format?: string;
  /**
   * `"auto"` climbs the kind's ladder (or uses the kind's default presentation,
   * such as scientific notation or a composite duration), `"never"` holds the
   * base unit and formats it as a plain number, `"scientific"` forces
   * scientific notation. Defaults to auto.
   */
  scale?: "auto" | "never" | "scientific";
  /**
   * Show the value in a different unit OF THE SAME KIND: `as: "°C"` on a kelvin
   * field, `as: "g"` on an m/s² one. This is the presentation half of "SI on
   * the wire": the contract states what a field IS, and this states what the
   * operator wants to READ, without either one lying to the other.
   *
   * A cross-kind request is refused rather than converted, and the value renders
   * in its true unit.
   */
  as?: string;
  /** Override the kind's decimal places. */
  decimals?: number;
  /**
   * The rung the value was last shown at, so a value hovering on a boundary
   * does not flicker. See `formatQuantity`'s note on hysteresis.
   */
  heldSymbol?: string;
}

export interface FormattedQuantity {
  /** The scaled number, formatted. `NULL_DISPLAY` when there is no value. */
  value: string;
  /** The symbol to show beside it. Empty when the unit is unknown or bare. */
  symbol: string;
  /** The rung actually used, to feed back as `heldSymbol` on the next render. */
  rung: string;
}

/**
 * How far a value must fall BELOW a rung's threshold before dropping back down.
 * Without it a vessel hovering at 999.6 m flickers between "1.0 km" and "1000 m"
 * every frame, which reads as a broken instrument rather than a still one.
 */
const HYSTERESIS = 0.05;

/**
 * The kinds counted like money rather than measured like a quantity. They
 * group from a thousand, and their symbols attach: see ATTACHED_SYMBOLS for
 * the other half of the same exception.
 */
const COUNTED_LIKE_MONEY: ReadonlySet<string> = new Set([
  "funds",
  "science",
  "reputation",
]);

/**
 * `useGrouping`'s string form is ES2023 and this workspace targets ES2022, so
 * the bundled lib still types it as a boolean. Every runtime the package ships
 * to has taken the strings for years; only the type is behind.
 *
 * Declared here and cast once at the constructor, rather than raising the
 * package's `lib`: this is the published package an Uplink imports, and
 * widening its language assumptions to buy one option's type would be a much
 * larger promise than the one being made.
 */
interface GroupingOptions
  extends Omit<Intl.NumberFormatOptions, "useGrouping"> {
  useGrouping?: "always" | "auto" | "min2" | boolean;
}

/**
 * The locale every quantity in the app is written in.
 *
 * `undefined` means the reader's own, which is the right answer for everyone
 * except a test. A locale changes how a number is WRITTEN and never what it
 * is: `1,234,567.5` here, `1 234 567,5` in France, `12,34,567.5` in India,
 * Arabic-Indic digits in Egypt. Somebody who reads numbers one way should see
 * them that way, and this layer exists precisely so that is one decision.
 *
 * A TEST is the exception, and the only one. A snapshot rendered on a machine
 * with a French locale has to match one rendered on an American runner, so
 * every package's test setup pins this to `en-GB`, and
 * `styleguide-pinned-locale.test.ts` fails the build if a new one forgets.
 */
let locale: string | undefined;

/**
 * Pin the locale every quantity is written in, or pass `undefined` to go back
 * to the reader's own.
 *
 * One call changes every readout in the app at once, which is what having one
 * formatter buys. Test setups use it to make a render reproducible; an app
 * would use it to honour a preference.
 */
export function setQuantityLocale(next: string | undefined): void {
  locale = next;
  formatters.clear();
}

/**
 * Building an `Intl.NumberFormat` is the expensive half of `Intl`, and this
 * runs once per readout per frame on a dashboard with dozens of them. Calling
 * `format` on a built one is cheap, so they are kept.
 */
const formatters = new Map<string, Intl.NumberFormat>();

function numberFormat(decimals: number, money: boolean): Intl.NumberFormat {
  const key = `${locale ?? ""}|${decimals}|${money}`;
  let existing = formatters.get(key);
  if (existing === undefined) {
    const options: GroupingOptions = {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      // `min2` IS SI's rule, spelled as a standard option: separate numbers of
      // more than four digits, leave four-digit ones alone, so `3200 K` reads
      // as it does on an instrument. `always` is how money is written, and
      // money is not an SI quantity: `2,340f`, not `2340f`.
      useGrouping: money ? "always" : "min2",
    };
    existing = new Intl.NumberFormat(
      locale,
      options as Intl.NumberFormatOptions,
    );
    formatters.set(key, existing);
  }
  return existing;
}

/**
 * A fixed-precision number, grouped.
 *
 * Grouping was missing here for as long as this module has existed, and it did
 * not show because the LADDERED kinds climb a rung before they get long: a
 * length reaching five digits becomes `12.4 km`. The kinds that stay long are
 * the ones with no ladder to climb, which is currencies, science and
 * reputation, and every readout showing those had reached for `toLocaleString`
 * at the call site. Five of them had. That is the same duplication this module
 * exists to remove, one formatting decision at a time.
 *
 * SI would prefer a thin space to a comma, which is unavailable here for a
 * specific reason: `<Unit>` already puts a thin space between the number and
 * its symbol, and a second one inside the number reads as a second quantity.
 * That is a matter for the locale to settle rather than for this function.
 */
function fixed(value: number, decimals: number, kind?: string): string {
  return numberFormat(
    decimals,
    kind !== undefined && COUNTED_LIKE_MONEY.has(kind),
  ).format(value);
}

/**
 * Format a value for display, given the unit the contract declared for it.
 *
 * Returns the parts separately rather than a joined string, because callers
 * need them apart: a readout renders the number large and the symbol small, and
 * an axis wants the number alone with the symbol in the axis label.
 */
export function formatQuantity(
  value: number | null | undefined,
  unit: string | undefined,
  opts: FormatQuantityOptions = {},
): FormattedQuantity {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { value: NULL_DISPLAY, symbol: "", rung: unit ?? "" };
  }

  // Apply the operator's presentation unit BEFORE anything else, so everything
  // downstream (ladder, precision, notation) reasons about the unit actually
  // being shown. Refused outright when the kinds differ: a wrong number under a
  // right-looking label is the failure this whole module exists to prevent.
  if (opts.as !== undefined && opts.as !== unit && unit !== undefined) {
    const conversion = CONVERSION_BY_PAIR[`${unit}→${opts.as}`];
    if (conversion && kindOfUnit(opts.as) === kindOfUnit(unit)) {
      const { as: _as, ...rest } = opts;
      return formatQuantity(
        value / conversion.per + conversion.offset,
        opts.as,
        rest,
      );
    }
  }

  const kind = kindOfUnit(unit);

  // A pinned unit is applied before anything downstream reasons about scaling,
  // so the ladder, the precision and the symbol all describe the unit actually
  // being shown. Refused when the kinds differ or either ratio is unknown: a
  // wrong number under a right-looking label is the failure this module exists
  // to prevent, and silently ignoring the request is better than inventing a
  // conversion factor.
  // Not gated on the format DIFFERING from the unit. Pinning the unit a value
  // already carries still has to defeat the ladder, or `format="m"` on a
  // 12,400 m value would climb to km and the prop would be a suggestion.
  if (opts.format !== undefined && unit !== undefined) {
    const from = ratioOf(unit);
    const to = ratioOf(opts.format);
    if (
      from !== undefined &&
      to !== undefined &&
      kindOfUnit(opts.format) === kind
    ) {
      const { format: _format, ...rest } = opts;
      return formatQuantity((value * from) / to, opts.format, {
        ...rest,
        // The pinned unit IS the answer, so nothing may climb away from it.
        scale: "never",
      });
    }
  }

  // A ratio is 0..1 and shown as a percentage; a percent token that is already
  // 0..100 is a different unit and must not be multiplied again. Keeping them
  // distinct is the single most common unit bug in a dashboard.
  if (kind === "ratio") {
    const decimals = opts.decimals ?? DECIMALS.ratio ?? 0;
    return { value: fixed(value * 100, decimals), symbol: "%", rung: "%" };
  }

  // An undeclared unit renders bare rather than guessed at. "1" is explicitly
  // dimensionless, which is not the same as absent, and also renders bare.
  if (unit === undefined || unit === "1" || kind === undefined) {
    const decimals = opts.decimals ?? (kind ? DECIMALS[kind] : undefined);
    return {
      value: decimals === undefined ? String(value) : fixed(value, decimals),
      symbol: unit === undefined || unit === "1" ? "" : unit,
      rung: unit ?? "",
    };
  }

  // `"never"` means "give me the plain base-unit number", so it opts out of the
  // composite and scientific presentations as well as the ladder. It is for a
  // caller that wants the reading in the unit the contract declared rather than
  // in whichever one the ladder picked. NOT for a caller that means to parse
  // the result back into a number: the string is grouped, so read `magnitude`
  // off the value instead.
  if (opts.scale !== "never") {
    if (opts.scale === "scientific" || SCIENTIFIC.has(kind)) {
      return {
        value: toScientific(
          value,
          opts.decimals === undefined
            ? SCIENTIFIC_SIGNIFICANT
            : opts.decimals + 1,
        ),
        symbol: displaySymbol(unit, kind),
        rung: unit,
      };
    }

    // Time is a ladder, just not a decimal one: it climbs by 60 and 6 and 426
    // rather than by 1000, and it shows two tiers at once because "2h 15m" is
    // how a countdown is read. `formatDuration` already encodes all of that,
    // including KSP's 6-hour day, so this delegates rather than restating it.
    // The symbol comes back empty because the parts are interleaved with the
    // number and cannot be split off the way "12.4" and "km" can.
    //
    // Both duration formatters take SECONDS, so the declared unit's ratio has
    // to be applied on the way in. A field declared in days is 43 days, not 43
    // seconds, and handing the raw magnitude over rendered it as the latter
    // under a label that still read like the former.
    //
    // `ratioOf` and not the generated table: `d`, `h`, `min` and `y` are sized
    // by the calendar the GAME reported, and only `ratioOf` asks it. Freezing
    // the stock 21,600 here would put the same bug back one layer down.
    if (kind === "time") {
      return {
        value: formatDuration(value * (ratioOf(unit) ?? 1)),
        symbol: "",
        rung: "s",
      };
    }

    // `irlTime` is the same ladder on a real day, and it is a SEPARATE kind
    // rather than an option on this one so the two cannot be handed to each
    // other by accident. A staleness badge and a mission clock sit side by
    // side in this UI, and the difference between them is a factor of four
    // that renders as a plausible number.
    if (kind === "irlTime") {
      return {
        value: formatIrlDuration(value * (ratioOf(unit) ?? 1)),
        symbol: "",
        rung: "irl:s",
      };
    }

    // A universal time is an INSTANT, not a length, and it is the one kind that
    // was in the union and never in this dispatch. Falling through to the
    // generic numeric path rendered it as "12,345,678.00 ut", which is a true
    // statement about the wrong quantity: the number is right and it is not a
    // number anybody reads.
    //
    // It must not go on the time ladder either. That would render the same
    // instant as "1y 145d", which is how long the game has been running rather
    // than when this happened, and the two are confusable precisely because
    // both look like plausible answers.
    //
    // Delegates to `formatKspDate`, the same formatter `<MissionDate>` uses,
    // rather than restating it: the calendar is whichever one the GAME reported
    // (six-hour days on stock Kerbin, 24 under a planet pack), so a second
    // implementation here would be a second thing to keep in step with
    // `setKspCalendar`. The symbol comes back empty for the same reason the
    // duration branch's does: the parts are interleaved with the number and
    // cannot be split off the way "12.4" and "km" can.
    //
    // Note this ACCEPTS a UT where `<Countdown>` refuses one. Refusing is right
    // there because rendering an instant as a duration is meaningless; here
    // rendering it as a date is correct and unambiguous, and refusing would only
    // push every call site to a second component for nothing.
    if (kind === "universalTime") {
      return { value: formatKspDate(value), symbol: "", rung: "ut" };
    }
  }

  const ladder = opts.scale === "never" ? undefined : ladderForUnit(unit);
  const decimals = opts.decimals ?? DECIMALS[kind] ?? 2;

  // Where the non-dimensional kinds land: they have a kind (so they round to a
  // sensible precision) and no ladder (so they never scale), and `displaySymbol`
  // is what keeps "12 count" off the screen.
  if (!ladder) {
    return {
      value: fixed(value, decimals, kind),
      symbol: displaySymbol(unit, kind),
      rung: unit,
    };
  }

  const base = toBase(value, ladder, unit);

  const magnitude = Math.abs(base);
  let chosen = ladder[0];
  for (const rung of ladder) {
    if (magnitude >= rung.from) chosen = rung;
  }

  // Hold the previous rung while the value sits just under its threshold, so a
  // hovering reading does not oscillate. Only ever holds a HIGHER rung: a value
  // climbing past a boundary should scale up promptly.
  if (opts.heldSymbol && opts.heldSymbol !== chosen.symbol) {
    const held = ladder.find((r) => r.symbol === opts.heldSymbol);
    if (
      held &&
      held.from > chosen.from &&
      magnitude >= held.from * (1 - HYSTERESIS)
    ) {
      chosen = held;
    }
  }

  const scaled = base / chosen.per;

  /*
   * The lowest rung has no rung beneath it to climb down to, so a reading too
   * small for its decimals would round to zero: a thinning atmosphere reads as
   * vacuum, a trickle of pressure as none. A nonzero reading must never render
   * as zero, so it goes to scientific notation on that same rung instead, with
   * the significant figures the scientific kinds use. An exact zero stays fixed.
   */
  if (
    scaled !== 0 &&
    chosen === ladder[0] &&
    Math.abs(scaled) * 10 ** decimals < 0.5
  ) {
    return {
      value: toScientific(
        scaled,
        opts.decimals === undefined
          ? SCIENTIFIC_SIGNIFICANT
          : opts.decimals + 1,
      ),
      symbol: chosen.symbol,
      rung: chosen.symbol,
    };
  }

  return {
    value: fixed(scaled, decimals),
    symbol: chosen.symbol,
    rung: chosen.symbol,
  };
}

/**
 * A scale: one rung, settled once, and every mark printed against it.
 *
 * A moving-scale instrument (an altimeter strip, a chart axis, a ruler down the
 * edge of a widget) has a shape no single-value formatter fits. Its marks go in
 * a narrow gutter, so they carry NO symbol; the symbol is shown once at the head
 * of the scale; and every mark has to sit on the same rung, because a ruler
 * whose marks change unit partway up is not a ruler. Ask each mark to format
 * itself and the ladder answers per magnitude, which is how a strip ends up
 * reading "500 m" three marks below "1.0 km".
 *
 * So the rung is settled ONCE here, from the value the caller says defines the
 * scale (the top of the strip, the axis maximum), and {@link QuantityScale.mark}
 * pins every mark to it. Holding that rule in one place is the whole reason this
 * exists: a caller pinning each mark by hand has to remember to, on every call,
 * and the failure is silent when they do not.
 *
 * It is deliberately NOT a way to get a formatted string in general. There is no
 * joined form: a caller who wants "12.4 km" wants {@link writeQuantity}, and one
 * who can render a node wants `<Unit>`. What this hands back is the two halves
 * APART, which is the thing neither of those can do and the only reason to be
 * here.
 *
 * It is also not the way to align a GROUP of readouts, which is a different
 * question with a different answer. A scale has a reference: the top of the
 * strip is the axis and every mark on it is below that by construction. A band
 * has two ends and a table column has N cells, so there is nothing to nominate,
 * and `<UnitSharedFormat>` settles those from what its members report instead. Reach
 * for this one only where the caller genuinely knows the bound.
 */
export interface QuantityScale {
  /** The unit every mark is printed in. */
  readonly rung: string;
  /**
   * The symbol for that rung, to show ONCE beside the scale. Empty for a kind
   * that displays none, in which case the scale shows no header at all.
   */
  readonly symbol: string;
  /**
   * One mark, as the bare number: no symbol, because {@link symbol} carries it
   * for the whole scale.
   */
  mark(magnitude: number | null | undefined): string;
}

/**
 * Build a {@link QuantityScale} whose rung is taken from `reference`.
 *
 * `reference` is the value that DEFINES the scale rather than a value on it:
 * the top of an altimeter strip, an axis maximum. Its magnitude decides the
 * rung, and every mark then follows, including marks far smaller than it.
 *
 * `opts.format` pins the rung outright, for the cases where convention beats
 * magnitude, and is passed straight through.
 */
export function quantityScale(
  reference: { magnitude: number; unit: string } | null | undefined,
  opts: FormatQuantityOptions = {},
): QuantityScale {
  const head = formatQuantity(reference?.magnitude, reference?.unit, opts);
  const unit = reference?.unit;
  return {
    rung: head.rung,
    symbol: head.symbol,
    mark: (magnitude) =>
      formatQuantity(magnitude, unit, { ...opts, format: head.rung }).value,
  };
}

/**
 * `value`, in the base unit of the ladder it climbs.
 *
 * The declared unit is not necessarily the ladder's base. The contract carries
 * what KSP sends, and KSP sends tonnes and kN, so a field can arrive already
 * partway up its own ladder. Normalising before anything compares magnitudes is
 * what keeps the comparison in one dimension: 5 t measured against KILOGRAM
 * thresholds falls to the bottom rung and renders "5.00 kg", a 1000x error
 * wearing a plausible label.
 */
function toBase(
  value: number,
  ladder: readonly Rung[] | undefined,
  unit: string | undefined,
): number {
  const declared = ladder?.find((r) => r.symbol === unit);
  return declared ? value * declared.per : value;
}

/** Where one reading sits on the ladder it climbs. */
export interface LadderPosition {
  /**
   * How big it is in the ladder's BASE unit, absolute.
   *
   * The comparable figure, and comparing anything else is the bug: two readings
   * of one kind can arrive on different rungs (KSP sends tonnes and kN), so
   * `5 t` taken as it came is the smaller of `5 t` and `900 kg`.
   */
  readonly base: number;
  /** The rung this reading ALONE would climb to, which is what a group votes with. */
  readonly rung: string;
}

/**
 * Where a reading sits on its ladder, for a caller settling one rung across
 * several readings.
 *
 * Both halves of what such a caller needs and neither of them a formatted
 * string: how the readings compare, and what each of them would have chosen by
 * itself. The choice between them is the caller's; running the ladder is this
 * module's, and asking here is what keeps a second copy of it from growing
 * beside a group renderer.
 */
export function ladderPosition(
  magnitude: number,
  unit: string | undefined,
): LadderPosition {
  const ladder = ladderForUnit(unit);
  return {
    base: Math.abs(toBase(magnitude, ladder, unit)),
    rung: formatQuantity(magnitude, unit).rung,
  };
}

/**
 * The set of rungs a unit may climb within, as a key: two readings can settle
 * on one rung exactly when they share this.
 *
 * Undefined for a unit that never climbs, which is most of them, and that
 * absence is the guard rather than an omission. A duration, a mission date and
 * a gravitational parameter all report a `rung` that is not a unit anything may
 * be pinned to (`"s"`, `"ut"`, the value's own symbol under scientific
 * notation), so a group that tried to settle one for them would render a true
 * statement about the wrong quantity. A currency, a ratio and a temperature
 * have nothing to settle in the first place.
 *
 * Keyed by the LADDER a unit declares, never by its kind. Bits and bytes are
 * both `data` and must never share rungs, so keying on kind would put a bit
 * reading on a byte rung the moment the two appeared in one group.
 */
export function unitScaleKey(unit: string | undefined): string | undefined {
  if (unit === undefined) return undefined;
  const kind = kindOfUnit(unit);
  if (kind === undefined || SCIENTIFIC.has(kind)) return undefined;
  if (ladderForUnit(unit) === undefined) return undefined;
  const name = ladderNameOf(unit);
  return name === undefined ? undefined : ladderGroupKey(name);
}

/** The key every unit on one ladder reports under. */
function ladderGroupKey(ladder: string): string {
  return `ladder:${ladder}`;
}

/**
 * The group a reading settles its whole FORMAT with, as a key.
 *
 * Wider than {@link unitScaleKey} on purpose, and the two answer different
 * questions. A rung can only be settled among readings that share a ladder; a
 * digit count can be settled among any readings written alike, and most units
 * have no ladder at all. An eccentricity band and an angle band both need
 * their ends to read apart, and neither climbs anything.
 *
 * So a unit on a ladder groups by the ladder, and a unit on none groups by
 * ITSELF. Grouping the second case by kind instead would put two units of one
 * kind that are never interconverted here into one group, where a digit count
 * chosen across them says nothing about either.
 *
 * A unit declared on a ladder that has no rungs registered yet still groups by
 * the ladder: that is what its declaration, and so {@link UnitGroupKey}, says.
 */
export function formatGroupKey(unit: string): string;
export function formatGroupKey(unit: string | undefined): string | undefined;
export function formatGroupKey(unit: string | undefined): string | undefined {
  if (unit === undefined) return undefined;
  const scale = unitScaleKey(unit);
  if (scale !== undefined) return scale;
  const declared = declarationOf(unit);
  return declared?.ladder === undefined
    ? `unit:${unit}`
    : ladderGroupKey(declared.ladder);
}

/**
 * The group a PIN is addressed to, from the token a caller keyed it by.
 *
 * The mirror of {@link formatGroupKey}, which answers the same question for a
 * reading. A reading arrives holding a unit and has its group derived; a pin is
 * written by hand and names the group outright, so a ladder name is a key here
 * and never a key there. See {@link UnitGroupKey}.
 *
 * A token this build knows nothing about still resolves, as an unladdered unit
 * would, rather than throwing: a symbol reaching a scope is a reading to be
 * formatted, not a mistake to refuse.
 */
export function pinGroupKey(token: string): string {
  return LADDER_KINDS[token] === undefined
    ? formatGroupKey(token)
    : ladderGroupKey(token);
}

/** How many digits it takes for two distinct readings to READ as distinct. */
const MAX_SEPARATING_DECIMALS = 6;

/** One reading of a group, as the rules below compare them. */
export interface FormatMember {
  /** The reading, in the unit it arrived in. */
  readonly reading: number;
  /** The unit it arrived in, which need not be the one it is written at. */
  readonly unit: string;
}

/**
 * Where a reading sits on its own ladder in the ladder's base unit, signed.
 *
 * {@link ladderPosition} answers the same question in absolute terms, because
 * a group rung is chosen by which reading is SMALLEST and a sign has no
 * bearing on that. Ordering a group does need the sign, which is why this is
 * not that.
 */
function baseMeasure(reading: number, unit: string): number {
  return toBase(reading, ladderForUnit(unit), unit);
}

/**
 * The digit count at which the readings of a group stop printing the same
 * thing as each other, or undefined to leave the kind's own default alone.
 *
 * An interval rendered as independent quantities can collapse into one figure,
 * silently, exactly where its width was the point: a semi-major axis band of
 * 6 700 km to 6 710 km lands on the megametre rung, where a length's default
 * one decimal prints both ends as `6.7 Mm`. This is the rule that widens the
 * digits until the readings differ, and it lives here rather than beside a
 * renderer because answering it means knowing what the ladder and the kind's
 * precision will actually do, which is this module's own knowledge.
 *
 * <p><b>Adjacent readings are the whole comparison.</b> Rounding to a fixed
 * count never reorders, so if any two distinct readings print alike then two
 * ADJACENT ones do, and sorting first turns a quadratic sweep into a linear
 * one. Ordering is by base measure rather than by raw number, so a group
 * holding both `900 kg` and `5 t` is compared in one dimension.</p>
 *
 * <p><b>Readings that are equal are left alone.</b> There is nothing to
 * separate, and widening a group whose members genuinely agree prints six
 * decimals of noise in place of one honest figure.</p>
 *
 * <p><b>It only ever widens.</b> A COARSER digit count can separate two
 * readings the default prints identically, by rounding them away from each
 * other across a boundary the interval never reaches: a one-sigma band of
 * 47.471 to 47.529 reads as `47.5 – 47.5` at the default single decimal and as
 * `47 – 48` at none, and the second is an interval seventeen times the width
 * the producer offered. Both are wrong and the second is worse, because it
 * looks like an answer. So the default is asked first and kept whenever it
 * separates, and the search below starts at the default's own precision rather
 * than at zero.</p>
 */
export function separatingDecimals(
  members: readonly FormatMember[],
  opts: { format?: string; as?: string } = {},
): number | undefined {
  if (members.length < 2) {
    return undefined;
  }
  const ordered = [...members].sort(
    (a, b) => baseMeasure(a.reading, a.unit) - baseMeasure(b.reading, b.unit),
  );
  /** One reading, under a given precision, or under the kind's own default. */
  const show = (member: FormatMember, decimals?: number) =>
    formatQuantity(
      member.reading,
      member.unit,
      decimals === undefined ? opts : { ...opts, decimals },
    );
  const separatesAt = (decimals?: number): boolean =>
    ordered.every((member, index) => {
      if (index === 0) return true;
      const previous = ordered[index - 1];
      if (
        baseMeasure(previous.reading, previous.unit) ===
        baseMeasure(member.reading, member.unit)
      ) {
        return true;
      }
      const a = show(previous, decimals);
      const b = show(member, decimals);
      return a.value !== b.value || a.rung !== b.rung;
    });
  if (separatesAt()) {
    return undefined;
  }

  /*
   * How many decimals the default is already printing, found by asking which
   * fixed count reproduces it. Reproducing the string is the only way to ask:
   * `formatQuantity` chooses the count from the kind and the rung and does not
   * report it back, and counting the digits after a separator in the output
   * cannot tell a decimal point from a grouping mark under an arbitrary
   * locale. Zero when nothing reproduces it (a laddered or notated rendering),
   * which falls back to the whole range and is the behaviour this had before.
   */
  const lowest = ordered[0];
  const printedByDefault = show(lowest).value;
  let from = 0;
  for (let decimals = 0; decimals <= MAX_SEPARATING_DECIMALS; decimals++) {
    if (show(lowest, decimals).value === printedByDefault) {
      from = decimals;
      break;
    }
  }
  for (let decimals = from; decimals <= MAX_SEPARATING_DECIMALS; decimals++) {
    if (separatesAt(decimals)) {
      return decimals;
    }
  }
  /*
   * Widening ran out of room without separating them, so these readings differ
   * by less than any precision here can express. Fall back to the kind's own
   * default, which is what genuinely equal readings already get.
   *
   * Returning the maximum instead is what this did, and it spent six decimals
   * to print the same figure twice: two adjacent doubles 7.3e-12 m apart
   * rendered `65.286800 km - 65.286800 km`, while ends that were EXACTLY equal
   * rendered `65.3 km`. Two indistinguishable inputs, two visibly different
   * answers, and the wordier one reads as the more precise.
   *
   * The floor is "widening stopped working", detected rather than assumed:
   * nothing here needs to know the unit's rung or pick a magnitude, and a band
   * that genuinely separates still gains every digit it needs.
   *
   * It is also the consumer half of a rule the producer already follows. A fit
   * whose residuals are its own arithmetic's rounding publishes no band at all
   * (`atmospheric-reckoning.ts`, FLOAT_RESIDUE_ULPS): "every sample on one line
   * is a DEGENERATE estimate, not evidence that an extrapolation is exact, and
   * a zero-width band is read downstream as the second thing". A difference
   * below the display rung is the same claim made in decimals.
   */
  return undefined;
}

/**
 * Whether a group reads as ONE figure: every member comes out as the same text
 * at the format the group has settled on.
 *
 * <p>This is what a band asks before it decides to draw two ends. Two readings
 * it cannot tell apart offer a width and then print none: `65.3 km – 65.3 km`
 * shows the reader two numbers, tells them they differ, and shows no
 * difference. One figure marked approximate says the true thing instead, and
 * the operator's rule for when to do it is exactly this question: "anytime
 * we'd shown the same numbers on each side".</p>
 *
 * <p><b>No tolerance, and nothing to tune.</b> It compares the rendered text
 * rather than the magnitudes, so ends that are exactly equal, ends a single
 * ULP apart and ends below the rung all answer true without being named as
 * cases, and a pair the ladder did separate answers false. A gap threshold
 * would be a number someone has to defend later, which is what
 * {@link separatingDecimals} declined to introduce for the same question.</p>
 *
 * <p>Asked with the SETTLED options, after the ladder has run: the figures it
 * compares have to be the ones that will be drawn, or it is answering about a
 * rendering nobody sees.</p>
 */
export function readsAsOneFigure(
  members: readonly FormatMember[],
  opts: { format?: string; as?: string; decimals?: number } = {},
): boolean {
  if (members.length < 2) {
    return false;
  }
  const shown = members.map((member) =>
    formatQuantity(member.reading, member.unit, opts),
  );
  const first = shown[0];
  return shown.every(
    (other) => other.value === first.value && other.rung === first.rung,
  );
}

// Last, so every table the registrations write to exists before the replay of
// the ones an Uplink made before this module loaded.
onUnitRegistered(applyRegisteredUnit);
