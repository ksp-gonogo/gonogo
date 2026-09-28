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
 * What the declaration says `Unit` measures, or `never` for a symbol nothing
 * declares.
 *
 * Every type in this module reads `UnitDeclarations` and nothing else, which is
 * what makes a unit an Uplink merges into it indistinguishable here from a
 * first-party one.
 */
type KindOfSymbol<Unit extends string> = Unit extends DeclaredUnit
  ? UnitDeclarations[Unit] extends { kind: infer Kind }
    ? Kind
    : never
  : never;

/** Every declared symbol that measures `Kind`. */
type SymbolsOfKind<Kind> = {
  [Unit in DeclaredUnit]: KindOfSymbol<Unit> extends Kind ? Unit : never;
}[DeclaredUnit];

/** The ladder `Unit` is declared on, or `never` for a unit that climbs none. */
type LadderOfSymbol<Unit extends string> = Unit extends DeclaredUnit
  ? UnitDeclarations[Unit] extends { ladder: infer Ladder extends string }
    ? Ladder
    : never
  : never;

/**
 * Every symbol of kind `Kind` that exists only as a conversion TARGET (`°C`),
 * which the declarations do not name and {@link kindOfConversion} still
 * resolves. A pair whose source is itself undeclared is skipped, or `°C→K`
 * would make every kind accept `K`.
 */
type ConversionTargetsOfKind<Kind> = {
  [Conversion in keyof typeof CONVERSIONS]: Conversion extends `${infer Source}→${infer Target}`
    ? [KindOfSymbol<Source>] extends [never]
      ? never
      : [KindOfSymbol<Source>] extends [Kind]
        ? Target
        : never
    : never;
}[keyof typeof CONVERSIONS];

/**
 * Every unit that measures the same thing as `Unit`, which is exactly the set a
 * value in `Unit` may be re-expressed in.
 *
 * This is what makes `format="km/h"` check on a speed and fail on a length. A
 * unit an Uplink declares in `UnitDeclarations` widens the accepted set.
 *
 * A literal symbol nothing declares accepts no format at all, since there is no
 * kind to check the request against. Only a wide `string` accepts any string.
 */
export type FormatsFor<Unit extends string> = string extends Unit
  ? string
  : FormatsForKind<KindOfSymbol<Unit>>;

/**
 * {@link FormatsFor}, asked of the KIND rather than of one of its units, for a
 * pin addressed to a whole group that has no single unit to check against.
 */
export type FormatsForKind<Kind> = SymbolsOfKind<Kind>;

/**
 * Every unit a value in `Unit` may be SHOWN as, which is every unit of its kind
 * plus the presentation-only ones the conversion table reaches.
 *
 * Wider than {@link FormatsFor} by exactly the symbols that are not on the
 * wire: `format` pins a rung, `as` re-expresses, so `°C` belongs only to `as`.
 * Both refuse a cross-kind request: `as="kg"` on a length is an error.
 */
export type PresentableAs<Unit extends string> = string extends Unit
  ? string
  : PresentableAsKind<KindOfSymbol<Unit>>;

/** {@link PresentableAs}, asked of the KIND. See {@link FormatsForKind}. */
export type PresentableAsKind<Kind> =
  | SymbolsOfKind<Kind>
  | ConversionTargetsOfKind<Kind>;

/**
 * How many of the kind's BASE unit one of `symbol` is worth.
 *
 * The LIVE CALENDAR first, because `d`, `h`, `min` and `science/day` are sized
 * by the running game and codegen bakes stock Kerbin figures for all four.
 * Then the unit's declared ratio, then the rung's own divisor. The calendar
 * table is the SDK's, so a formatted duration and a computed one agree.
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

/*
 * Unit-aware value formatting. The contract declares what a field IS (metres,
 * m/s, kelvin) and this decides how to SHOW it. The wire is canonical SI and
 * never pre-scaled, because a pre-scaled value cannot be graphed, diffed or
 * re-scaled by a consumer; scaling is a presentation decision.
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
  // An INSTANT on the game's clock, not a length of it: render it with `<MissionDate>`, not `<Unit>`.
  | "universalTime"
  // Seconds by dimension but not a duration: a 320 s engine must not read "5min 20s".
  | "specificImpulse"
  // Wall-clock time, where a day is 24 hours rather than the game's 6.
  | "irlTime"
  | "planeAngle"
  | "power"
  // Data at rest (a file, a drive), bit-based like `dataRate` but not interchangeable with it.
  | "data"
  | "dataRate"
  | "doseRate"
  | "irradiance"
  | "level"
  | "density"
  // Kilograms per second, unlike `resourceFlow`, which counts in whatever the tank counts in.
  | "massFlow"
  | "gravParameter"
  | "dimensionless"
  | "percent"
  | "scienceData"
  | "scienceRate"
  | "ratio"
  /*
   * Non-dimensional kinds: "this has no physical dimension", unlike
   * `dimensionless` (a real measurement with no unit, Mach and TWR) and unlike
   * an absent unit (nobody said). They let the contract DECLARE non-quantities.
   */
  | "area"
  | "volume"
  | "angularSpeed"
  | "funds"
  | "science"
  | "reputation"
  // Currencies that FLOW: a rate wants a decimal where a balance does not.
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
 * The `string & {}` arm lets a third-party Uplink introduce its own dimension
 * while the known kinds still autocomplete.
 */
export type QuantityKind = KnownQuantityKind | (string & {});

/** One rung of a scaling ladder: a threshold in base units and its symbol. */
export type Rung = UnitRung;

/**
 * Ladders, ascending, each in its kind's base unit. A dimension with no entry
 * never scales.
 *
 * Deliberately absent:
 *  - `speed`, because delta-v and surface speed are read in m/s universally
 *  - `temperature`, because kelvin has no prefix convention and Celsius is an
 *    OFFSET conversion (see `as`)
 *  - `time`, which has its own composite formatter
 *  - `gravParameter`, which uses scientific notation (see `SCIENTIFIC`)
 *  - `planeAngle`, `ratio`, `dimensionless`, which have no magnitudes to climb
 */
export const LADDERS = {
  length: [
    { from: 0, symbol: "m", per: 1 },
    { from: 1e3, symbol: "km", per: 1e3 },
    { from: 1e6, symbol: "Mm", per: 1e6 },
    { from: 1e9, symbol: "Gm", per: 1e9 },
    // Out of reach in the stock system, kept so an outer-planets install does not stop at "1500.0 Gm".
    { from: 1e12, symbol: "Tm", per: 1e12 },
  ],
  // Every threshold and divisor is in KILOGRAMS, including the gram-based astronomical rungs (1 Yg is 1e21 kg).
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
  // Descends below the base unit: the upper atmosphere runs to fractions of a pascal.
  pressure: [
    { from: 0, symbol: "mPa", per: 1e-3 },
    { from: 1, symbol: "Pa", per: 1 },
    { from: 1e3, symbol: "kPa", per: 1e3 },
    { from: 1e6, symbol: "MPa", per: 1e6 },
  ],
  /*
   * Byte rungs on a BIT base, so a drive in MB and a link budget in bit/s are
   * commensurable. Decimal throughout (1 KB is 8e3 bit), matching `dataRate`;
   * the binary KiB family is deliberately absent. The `bit` rung keeps a
   * sub-byte reading from rendering as a fraction of a byte.
   */
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
  // Based in watts although the wire declares kW; the MW rung covers reentry heat flux.
  power: [
    { from: 0, symbol: "W", per: 1 },
    { from: 1e3, symbol: "kW", per: 1e3 },
    { from: 1e6, symbol: "MW", per: 1e6 },
    { from: 1e9, symbol: "GW", per: 1e9 },
  ],
  // One always-on rung: dose rates arrive in rad/s and are conventionally read in rad/h.
  doseRate: [{ from: 0, symbol: "rad/h", per: 1 / 3600 }],
  // Based in kg/m³ with a gram rung beneath it: sea-level air is about one kilogram per cubic metre, and the upper atmosphere is read in grams.
  density: [
    { from: 0, symbol: "g/m³", per: 1e-3 },
    { from: 1, symbol: "kg/m³", per: 1 },
  ],
} satisfies Record<string, readonly Rung[]>;

/**
 * Every ladder by name: the first-party ones above and every one a
 * registration has supplied rungs for since.
 */
const laddersByName: Record<string, readonly Rung[]> = { ...LADDERS };

/**
 * Every ladder a declared unit names, and therefore every group that settles
 * one rung together. A unit on none of them is a group of its own: `m`, `km`
 * and `Mm` are one group and `s` and `min` are two.
 */
export type LadderName = {
  [Unit in DeclaredUnit]: LadderOfSymbol<Unit>;
}[DeclaredUnit];

/**
 * What a pin may be addressed to: one GROUP, named the way the group is formed.
 *
 * A unit on a ladder is named by the ladder, because every unit of it settles
 * together and `m`, `km` and `Mm` are one thing to pin. Everything else is named
 * by the unit, because nothing interconverts it with its siblings and a pin on
 * `s` says nothing about `min`. Keyed this way, a group is pinned at most once
 * by construction.
 */
export type UnitGroupKey =
  | LadderName
  | {
      [Unit in DeclaredUnit]: [LadderOfSymbol<Unit>] extends [never]
        ? Unit
        : never;
    }[DeclaredUnit];

/**
 * What the group named by `Group` measures, so a pin addressed to it can be checked.
 *
 * A ladder key measures whatever its units do; a unit key resolves through the
 * declarations the same way a lone `<Unit>` does.
 */
export type KindOfGroup<Group extends UnitGroupKey> = Group extends LadderName
  ? {
      [Unit in DeclaredUnit]: [LadderOfSymbol<Unit>] extends [Group]
        ? [LadderOfSymbol<Unit>] extends [never]
          ? never
          : KindOfSymbol<Unit>
        : never;
    }[DeclaredUnit]
  : KindOfSymbol<Group>;

/**
 * Kinds that render in scientific notation when nothing says otherwise: their
 * exponent is huge and has no conventional prefix.
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

/** `3.532×10¹²`, not `3.532e12`, as a plain string usable in an axis label or `aria-label`. */
function toScientific(value: number, significant: number): string {
  if (value === 0) return "0";
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const mantissa = value / 10 ** exponent;
  // `significant` counts digits, and the mantissa always has exactly one before the point, so the rest are decimals.
  const digits = String(exponent)
    .split("")
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join("");
  return `${mantissa.toFixed(Math.max(0, significant - 1))}×10${digits}`;
}

/** Standard gravity, the SI definition, which is also KSP's single global constant and Kerbin's surface gravity. */
export { STANDARD_GRAVITY } from "@ksp-gonogo/sitrep-sdk";

import { STANDARD_GRAVITY } from "@ksp-gonogo/sitrep-sdk";

/**
 * Presentation conversions: what a value may be SHOWN as, given what it IS.
 *
 * Keyed source→target, `target = value / per + offset`, which covers the
 * offset conversions a ladder cannot. Only within a kind: `formatQuantity`
 * refuses a cross-kind conversion. `as const` is load-bearing, since
 * {@link PresentableAs} reads the pair KEYS.
 */
const CONVERSIONS = {
  "K→°C": { per: 1, offset: -273.15 },
  "°C→K": { per: 1, offset: 273.15 },
  "m/s²→g": { per: STANDARD_GRAVITY, offset: 0 },
  "g→m/s²": { per: 1 / STANDARD_GRAVITY, offset: 0 },
  "rad→°": { per: Math.PI / 180, offset: 0 },
  "°→rad": { per: 180 / Math.PI, offset: 0 },
} as const satisfies Record<string, { per: number; offset: number }>;

/** The same table, indexable by a key built at runtime. */
const CONVERSION_BY_PAIR: Record<string, { per: number; offset: number }> =
  CONVERSIONS;

/**
 * How much precision a kind is read at, as decimal places on the SCALED value.
 *
 * Per kind rather than per magnitude, so a readout holds a stable digit count
 * as the value moves.
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
  specificImpulse: 0,
  planeAngle: 2,
  density: 4,
  // A small RCS burn runs at a fraction of a kilogram a second, which must not round to zero.
  massFlow: 2,
  data: 1,
  dataRate: 1,
  power: 1,
  doseRate: 4,
  irradiance: 1,
  level: 1,
  dimensionless: 2,
  percent: 1,
  scienceData: 1,
  scienceRate: 1,
  ratio: 0,
  // A count is integral: "3.00 crew" is wrong in a way "3.00 Mach" is not.
  count: 0,
  id: 0,
  resourceUnits: 1,
  resourceFlow: 2,
  area: 1,
  volume: 1,
  angularSpeed: 0,
  funds: 0,
  science: 1,
  reputation: 1,
  // A reputation decaying by 0.11 a day rounds to nothing without decimals.
  fundsRate: 1,
  reputationRate: 2,
};

/**
 * What to SHOW beside the number, when it differs from the token the wire
 * carries. The non-dimensional tokens name a CATEGORY, not a symbol ("12
 * count" is not a readout), so they render with no symbol at all. `ratio` and
 * `time` carry extra behaviour and keep their own branches below.
 */
const DISPLAY_BY_KIND: Record<string, string> = {
  // Text fallbacks for the currency icons.
  funds: "f",
  science: "sci",
  reputation: "rep",
  // The wire token is `Mit`; the game writes "mits".
  scienceData: "mits",
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
 * it names none, matching `UnitGroupKey`. The ladder is declared rather than
 * taken from the kind because bits and bytes are both `data` and must never
 * interleave. An undeclared symbol is a rung and climbs the ladder listing it.
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
 * The ladder each rung symbol belongs to, since a rung such as `Mbit/s` is not
 * a declared unit. Built lazily and rebuilt whenever a registration supplies a
 * ladder.
 */
let rungLadders: Record<string, string> | undefined;

function rungLadderOf(symbol: string): string | undefined {
  if (rungLadders === undefined) {
    rungLadders = {};
    for (const [name, rungs] of Object.entries(laddersByName)) {
      for (const rung of rungs) {
        // First ladder wins, so a base symbol shared with the model keeps the model's answer rather than a ladder's.
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

/** The kind of a presentation-only unit (`°C`), named only by the conversion table. */
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
 * What each displayed symbol is CALLED, for the accessibility tree: a screen
 * reader announces `km` as "kay em" and `°` as nothing at all.
 *
 * Keyed on the DISPLAYED symbol rather than the wire token, so every rung and
 * every currency abbreviation has its own entry.
 */
const WORD_BY_SYMBOL: Record<string, string> = {
  m: "metres",
  km: "kilometres",
  Mm: "megametres",
  Gm: "gigametres",
  Tm: "terametres",
  kg: "kilograms",
  t: "tonnes",
  kt: "kilotonnes",
  Tg: "teragrams",
  Pg: "petagrams",
  Eg: "exagrams",
  Zg: "zettagrams",
  Yg: "yottagrams",
  N: "newtons",
  kN: "kilonewtons",
  MN: "meganewtons",
  mPa: "millipascals",
  Pa: "pascals",
  kPa: "kilopascals",
  MPa: "megapascals",
  W: "watts",
  kW: "kilowatts",
  MW: "megawatts",
  GW: "gigawatts",
  "bit/s": "bits per second",
  "kbit/s": "kilobits per second",
  "Mbit/s": "megabits per second",
  "Gbit/s": "gigabits per second",
  bit: "bits",
  B: "bytes",
  KB: "kilobytes",
  MB: "megabytes",
  GB: "gigabytes",
  "m/s": "metres per second",
  "m/s\u00B2": "metres per second squared",
  g: "gee",
  rpm: "revolutions per minute",
  "\u00B0": "degrees",
  "\u2032": "arcminutes",
  "\u2033": "arcseconds",
  rad: "radians",
  K: "kelvin",
  "\u00B0C": "degrees celsius",
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

function formatWhole(
  quantity: { magnitude: number; unit: string } | null | undefined,
  opts: FormatQuantityOptions,
): FormattedQuantity {
  return formatQuantity(quantity?.magnitude, quantity?.unit, opts);
}

/**
 * A quantity as a screen reader should hear it: the value followed by the
 * unit's WORD rather than its symbol.
 *
 * For the places that cannot take a node (`aria-label`, `title`, an SVG
 * `aria-valuetext`), so an accessible name reads "250.0 kilometres" rather
 * than "kay em". If the result is going to be rendered, use `<Unit>` or
 * `writeQuantity`. Falls back to the symbol for a unit with no word.
 */
export function speakQuantity(
  quantity: { magnitude: number; unit: string } | null | undefined,
  opts: FormatQuantityOptions = {},
): string {
  const { value: text, symbol } = formatWhole(quantity, opts);
  if (symbol === "") return text;
  return `${text} ${wordForSymbol(symbol) ?? symbol}`;
}

/**
 * The symbols written hard against the number: plane angle, because SI says so
 * (`22°`, but `22 °C`), and the currency marks, which are typography rather
 * than unit symbols (`42,500f`). Shared by `<Unit>` and `writeQuantity` so
 * both agree.
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
 * For visible text that cannot take a node: an SVG `<text>`, a canvas label, a
 * chart annotation measured before it is drawn. Anywhere a node fits, use
 * `<Unit>`; for an accessible name, `speakQuantity`.
 *
 * An ordinary space, not the thin space `<Unit>` sets, since a U+2009 is at
 * the mercy of the SVG or canvas renderer.
 */
export function writeQuantity(
  quantity: { magnitude: number; unit: string } | null | undefined,
  opts: FormatQuantityOptions = {},
): string {
  const { value: text, symbol } = formatWhole(quantity, opts);
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
 * What a unit symbol measures, or undefined for one we do not know: from its
 * declaration, then the ladder a rung belongs to, then the conversion that
 * names it.
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
 * Applies what one `registerUnit` call says about how a unit READS, including
 * registrations made before this module loaded.
 *
 * Two registrations of one symbol must mean the same thing by it, and two of
 * one ladder must climb the same rungs, so a disagreement throws rather than
 * rendering by load order. Identical registrations are a no-op, so two Uplinks
 * can share a ladder.
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
   * Pin the unit rather than letting the ladder choose, for where convention
   * beats magnitude (orbital velocity in km/s, a broadcast in km/h).
   *
   * Typed by KIND, so `format="km/h"` checks on a speed and is an error on a
   * length. Any unit of the same kind is accepted, including ones the ladder
   * would never pick.
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
   * field, `as: "g"` on an m/s² one. A cross-kind request is refused and the
   * value renders in its true unit.
   */
  as?: string;
  /** Override the kind's decimal places. */
  decimals?: number;
  /** The rung the value was last shown at, so a value hovering on a boundary does not flicker. */
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
 * How far a value must fall BELOW a rung's threshold before dropping back down,
 * so 999.6 m does not flicker between "1.0 km" and "1000 m".
 */
const HYSTERESIS = 0.05;

/** The kinds counted like money: they group from a thousand, and their symbols attach (see ATTACHED_SYMBOLS). */
const COUNTED_LIKE_MONEY: ReadonlySet<string> = new Set([
  "funds",
  "science",
  "reputation",
]);

/** `useGrouping`'s string form is ES2023 and the published package targets ES2022, so it is typed here and cast once. */
interface GroupingOptions
  extends Omit<Intl.NumberFormatOptions, "useGrouping"> {
  useGrouping?: "always" | "auto" | "min2" | boolean;
}

/**
 * The locale every quantity in the app is written in.
 *
 * `undefined` means the reader's own. Only a test pins it (to `en-GB`), so a
 * render is reproducible across machines.
 */
let locale: string | undefined;

/**
 * Pin the locale every quantity is written in, or pass `undefined` to go back
 * to the reader's own. One call changes every readout at once.
 */
export function setQuantityLocale(next: string | undefined): void {
  locale = next;
  formatters.clear();
}

/** Built `Intl.NumberFormat`s, cached because construction is expensive and this runs per readout per frame. */
const formatters = new Map<string, Intl.NumberFormat>();

function numberFormat(decimals: number, money: boolean): Intl.NumberFormat {
  const key = `${locale ?? ""}|${decimals}|${money}`;
  let existing = formatters.get(key);
  if (existing === undefined) {
    const options: GroupingOptions = {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      // `min2` is SI's rule (`3200 K`, `12,400 m`); money always groups (`2,340f`).
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
 * A fixed-precision number, grouped by the locale's separator rather than
 * SI's thin space, since `<Unit>` already puts a thin space before the symbol.
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

  // The presentation unit applies first so ladder, precision and notation describe the unit shown; a cross-kind request is refused.
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

  /*
   * A pin is refused when the kinds differ or either ratio is unknown, rather
   * than inventing a conversion factor. Not gated on the format differing
   * from the unit: `format="m"` on 12,400 m must still defeat the ladder.
   */
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
        scale: "never",
      });
    }
  }

  // A ratio is 0-1 and shown as a percentage; a percent token is already 0-100 and must not be multiplied again.
  if (kind === "ratio") {
    const decimals = opts.decimals ?? DECIMALS.ratio ?? 0;
    return { value: fixed(value * 100, decimals), symbol: "%", rung: "%" };
  }

  // An undeclared unit renders bare rather than guessed at, as does "1" (explicitly dimensionless).
  if (unit === undefined || unit === "1" || kind === undefined) {
    const decimals = opts.decimals ?? (kind ? DECIMALS[kind] : undefined);
    return {
      value: decimals === undefined ? String(value) : fixed(value, decimals),
      symbol: unit === undefined || unit === "1" ? "" : unit,
      rung: unit ?? "",
    };
  }

  // `"never"` opts out of the composite and scientific presentations as well as the ladder; the result is still grouped, so never parse it.
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

    /*
     * Durations interleave their parts with the number ("2h 15m"), so the
     * symbol is empty. The formatters take SECONDS, and `ratioOf` sizes `d`,
     * `h` and `min` by the calendar the game reported.
     */
    if (kind === "time") {
      return {
        value: formatDuration(value * (ratioOf(unit) ?? 1)),
        symbol: "",
        rung: "s",
      };
    }

    if (kind === "irlTime") {
      return {
        value: formatIrlDuration(value * (ratioOf(unit) ?? 1)),
        symbol: "",
        rung: "irl:s",
      };
    }

    // A universal time is an INSTANT: a date on the game's calendar, never a duration.
    if (kind === "universalTime") {
      return { value: formatKspDate(value), symbol: "", rung: "ut" };
    }
  }

  const ladder = opts.scale === "never" ? undefined : ladderForUnit(unit);
  const decimals = opts.decimals ?? DECIMALS[kind] ?? 2;

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

  // Only ever holds a HIGHER rung, so a value climbing past a boundary scales up promptly.
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

  // A nonzero reading too small for the lowest rung's decimals goes scientific rather than rendering as zero.
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
 * For a moving-scale instrument (an altimeter strip, a chart axis): the marks
 * carry NO symbol, the symbol is shown once at the head, and every mark sits
 * on the rung settled from the value that defines the scale, so a strip never
 * reads "500 m" three marks below "1.0 km".
 *
 * Not a general string formatter ({@link writeQuantity}, `<Unit>`), and not
 * for aligning a group of readouts with no known bound (`<UnitSharedFormat>`).
 */
export interface QuantityScale {
  /** The unit every mark is printed in. */
  readonly rung: string;
  /**
   * The symbol for that rung, to show ONCE beside the scale. Empty for a kind
   * that displays none, in which case the scale shows no header at all.
   */
  readonly symbol: string;
  /** One mark, as the bare number: {@link symbol} carries the unit for the whole scale. */
  mark(magnitude: number | null | undefined): string;
}

/**
 * Build a {@link QuantityScale} whose rung is taken from `reference`.
 *
 * `reference` is the value that DEFINES the scale rather than a value on it:
 * the top of an altimeter strip, an axis maximum. `opts.format` pins the rung
 * outright.
 */
export function quantityScale(
  reference: { magnitude: number; unit: string } | null | undefined,
  opts: FormatQuantityOptions = {},
): QuantityScale {
  const head = formatWhole(reference, opts);
  const unit = reference?.unit;
  return {
    rung: head.rung,
    symbol: head.symbol,
    mark: (magnitude) =>
      formatQuantity(magnitude, unit, { ...opts, format: head.rung }).value,
  };
}

/**
 * `value`, in the base unit of the ladder it climbs. KSP sends tonnes and kN,
 * so a field can arrive partway up its own ladder and must be normalised
 * before any magnitude comparison.
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
  /** How big it is in the ladder's BASE unit, absolute: the only figure comparable across rungs. */
  readonly base: number;
  /** The rung this reading ALONE would climb to, which is what a group votes with. */
  readonly rung: string;
}

/**
 * Where a reading sits on its ladder, for a caller settling one rung across
 * several readings: how they compare, and what each would choose alone.
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
 * Undefined for a unit that never climbs, deliberately: a duration, a mission
 * date and a scientific value report a `rung` nothing may be pinned to.
 *
 * Keyed by the LADDER a unit declares, never by its kind, since bits and bytes
 * are both `data` and must never share rungs.
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
 * Wider than {@link unitScaleKey}: a rung can only be settled among readings
 * that share a ladder, but a digit count can be settled among any readings
 * written alike. A unit on a ladder groups by the ladder (even one with no
 * rungs registered yet), and a unit on none groups by ITSELF, never by kind.
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
 * The mirror of {@link formatGroupKey}: a pin names its group outright, so a
 * ladder name is a key here and never there. An unknown token resolves as an
 * unladdered unit rather than throwing.
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
 * Where a reading sits on its own ladder in the ladder's base unit, signed for
 * ordering, unlike {@link ladderPosition}.
 */
function baseMeasure(reading: number, unit: string): number {
  return toBase(reading, ladderForUnit(unit), unit);
}

/**
 * The digit count at which the readings of a group stop printing the same
 * thing as each other, or undefined to leave the kind's own default alone.
 *
 * A band of 6 700 km to 6 710 km lands on the megametre rung, where the
 * default prints both ends as `6.7 Mm`; this widens the digits until they
 * differ.
 *
 * - Only adjacent readings (sorted by base measure) are compared, since
 *   rounding never reorders
 * - Equal readings are left alone
 * - It only ever widens: a coarser count can round two ends apart across a
 *   boundary the interval never reaches (`47.471` to `47.529` as `47 - 48`)
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
   * How many decimals the default prints, found by reproducing its string,
   * since counting digits cannot tell a decimal point from a grouping mark
   * under an arbitrary locale. Zero when nothing reproduces it.
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
  // Readings no precision here can separate get the kind's default, as genuinely equal readings do.
  return undefined;
}

/**
 * Whether a group reads as ONE figure: every member comes out as the same text
 * at the format the group has settled on.
 *
 * A band asks this before drawing two ends, so it never prints
 * `65.3 km - 65.3 km`. It compares the rendered text rather than magnitudes,
 * so there is no tolerance to tune. Ask with the SETTLED options, so the
 * figures compared are the ones that will be drawn.
 */
export function readsAsOneFigure(
  members: readonly (FormatMember | { magnitude: number; unit: string })[],
  opts: { format?: string; as?: string; decimals?: number } = {},
): boolean {
  if (members.length < 2) {
    return false;
  }
  const shown = members.map((member) =>
    "reading" in member
      ? formatQuantity(member.reading, member.unit, opts)
      : formatWhole(member, opts),
  );
  const first = shown[0];
  return shown.every(
    (other) => other.value === first.value && other.rung === first.rung,
  );
}

// Last, so every table the registrations write to exists before the replay of the ones an Uplink made before this module loaded.
onUnitRegistered(applyRegisteredUnit);
