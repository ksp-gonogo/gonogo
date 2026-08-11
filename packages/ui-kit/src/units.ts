import { calendarRatio } from "@ksp-gonogo/sitrep-sdk";
import { GENERATED_UNIT_KINDS } from "./__generated__/unit-kinds";

/** Every symbol the model declares. */
type GeneratedUnit = keyof typeof GENERATED_UNIT_KINDS;

/**
 * Every unit that measures the same thing as `U`, which is exactly the set a
 * value in `U` may be re-expressed in.
 *
 * This is what makes `format="km/h"` check on a speed and fail on a length. It
 * is a mapped type over the generated table, so a new unit in the model widens
 * the accepted set with nothing to keep in sync, and it is why that table is
 * emitted `as const`.
 *
 * A symbol outside the model (an Uplink's, a ladder-only rung) yields `never`
 * for its own kind, so the prop falls back to accepting any string rather than
 * refusing everything. Being unable to type-check a third party's unit is not
 * a reason to stop them asking for one.
 */
export type FormatsFor<U extends string> = [
  U extends GeneratedUnit ? (typeof GENERATED_UNIT_KINDS)[U]["kind"] : never,
] extends [infer K]
  ? [K] extends [never]
    ? string
    : {
        [S in GeneratedUnit]: (typeof GENERATED_UNIT_KINDS)[S]["kind"] extends K
          ? S
          : never;
      }[GeneratedUnit]
  : never;

/**
 * How many of the kind's BASE unit one of `symbol` is worth.
 *
 * Two sources, and neither is written by hand here: the model's declared
 * ratio, or the rung's own divisor for a rung the model has no unit for. The
 * multiplicative conversions this package used to hard-code (g to m/s², rad to
 * degrees) are just ratios and now come from the model like everything else.
 */
/**
 * How many of the kind's BASE unit one of `symbol` is worth.
 *
 * Three sources, in order. The LIVE CALENDAR first, because `d`, `h`, `min`
 * and `science/day` are sized by the running game rather than by physics and
 * codegen bakes stock Kerbin figures for all four. Then the model's declared
 * ratio, then the rung's own divisor for a rung the model has no unit for.
 *
 * The calendar table lives in the SDK, not here. It used to be duplicated in
 * this file, which meant the kit's DISPLAY path followed the game while
 * `Value` arithmetic in the SDK did not, so a formatted duration and a
 * computed one disagreed. One table, below both consumers, is the fix.
 */
function ratioOf(symbol: string): number | undefined {
  const fromCalendar = calendarRatio(symbol);
  if (fromCalendar !== undefined) return fromCalendar;
  const declared = GENERATED_UNIT_KINDS[symbol as GeneratedUnit];
  if (declared) return declared.ratio;
  for (const rungs of Object.values(LADDERS)) {
    const rung = rungs.find((r) => r.symbol === symbol);
    if (rung) return rung.per;
  }
  return undefined;
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
  // Time measured by a clock on the desk rather than by the game: how long
  // ago a reading arrived, how long a recorder ran. A day is 24 hours here
  // and 6 hours in `time`, which is why they are two kinds and not one.
  | "irlTime"
  | "planeAngle"
  | "power"
  | "dataRate"
  | "doseRate"
  | "irradiance"
  | "level"
  | "density"
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
export interface Rung {
  /** Values at or above this magnitude (in base units) use this rung. */
  from: number;
  symbol: string;
  /** Divide the base value by this to get the rung's value. */
  per: number;
}

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
export const LADDERS: Record<string, readonly Rung[]> = {
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
  // Descends below the base unit, which the others have no need to. Upper
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
};

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
export const STANDARD_GRAVITY = 9.80665;

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
 */
const CONVERSIONS: Record<string, { per: number; offset: number }> = {
  "K→°C": { per: 1, offset: -273.15 },
  "°C→K": { per: 1, offset: 273.15 },
  "m/s²→g": { per: STANDARD_GRAVITY, offset: 0 },
  "g→m/s²": { per: 1 / STANDARD_GRAVITY, offset: 0 },
  "rad→°": { per: Math.PI / 180, offset: 0 },
  "°→rad": { per: 180 / Math.PI, offset: 0 },
};

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
  planeAngle: 2,
  density: 4,
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
  count: "",
  id: "",
  text: "",
  flag: "",
  enum: "",
  "n/a": "",
};

/**
 * Kinds taught at runtime by {@link registerUnit}, layered over the generated
 * table. Empty until an Uplink registers something.
 *
 * There is deliberately no hand-written first-party table any more. ui-kit kept
 * one beside the SDK's for as long as both existed, and they drifted: seven
 * units disagreed on what their kind was CALLED, which matters because kind is
 * the key an Uplink's `declare module` augmentation targets.
 */
const REGISTERED_KINDS: Record<string, QuantityKind> = {};

/**
 * A rung is not a unit. `Mbit/s` and `kt` never appear in the contract and have
 * no entry in the model, but a formatter handed one back still has to know what
 * it measures. The ladder it belongs to already says, so the answer is derived
 * rather than stored: another table would be another thing to drift.
 *
 * Built lazily and rebuilt whenever a registration replaces a ladder.
 */
let rungKinds: Record<string, QuantityKind> | undefined;

function kindOfRung(symbol: string): QuantityKind | undefined {
  if (rungKinds === undefined) {
    rungKinds = {};
    for (const [kind, rungs] of Object.entries(LADDERS)) {
      for (const rung of rungs) {
        // First ladder wins, so a base symbol shared with the model keeps the
        // model's answer rather than a ladder's.
        rungKinds[rung.symbol] ??= kind;
      }
    }
  }
  return rungKinds[symbol];
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
      return (
        GENERATED_UNIT_KINDS[from as GeneratedUnit]?.kind ??
        REGISTERED_KINDS[from] ??
        kindOfRung(from)
      );
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
  "kg/m\u00B3": "kilograms per cubic metre",
  "m\u00B3/s\u00B2": "cubic metres per second squared",
  "m\u00B2": "square metres",
  "m\u00B3": "cubic metres",
  "%": "percent",
  Mit: "mits",
  "science/day": "science per day",
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
 * Four sources, in order, and NONE of them is a hand-written table in this
 * package: a runtime registration wins, then the generated model table, then
 * the ladder a rung belongs to, then the conversion that names it.
 */
export function kindOfUnit(
  symbol: string | undefined,
): QuantityKind | undefined {
  if (symbol === undefined) return undefined;
  return (
    REGISTERED_KINDS[symbol] ??
    GENERATED_UNIT_KINDS[symbol as GeneratedUnit]?.kind ??
    kindOfRung(symbol) ??
    kindOfConversion(symbol)
  );
}

export interface UnitDefinition {
  /** The symbol the wire carries, exactly. Case-sensitive: `m` and `M` differ. */
  symbol: string;
  /**
   * What it measures. May be a kind this package has never heard of; supplying
   * a new one is how an Uplink introduces a dimension of its own.
   */
  kind: QuantityKind;
  /** Decimal places on the scaled value. Defaults to the kind's, then to 2. */
  decimals?: number;
  /**
   * Scaling rungs, ascending, stated in the kind's BASE unit. Registering one
   * replaces the kind's ladder outright rather than merging, because a
   * half-overridden ladder is worse than either whole one.
   *
   * Every threshold and divisor must be in the same base unit. That is the
   * invariant behind `mass`: its symbols are gram-based while its numbers are
   * kilograms, and mixing the two is what made a real prefix bug possible.
   */
  ladder?: readonly Rung[];
  /** Render in scientific notation by default, as `gravParameter` does. */
  scientific?: boolean;
  /**
   * What to show beside the number, when it is not the symbol itself. Set it
   * to `""` for a token that names a category rather than a symbol, the way
   * the built-in `count` and `id` do.
   *
   * Applies to the KIND, not the symbol, matching how `decimals` and `ladder`
   * behave: a kind is the thing a presentation rule attaches to.
   */
  display?: string;
}

/**
 * Teach the formatter a unit it does not ship with.
 *
 * This is the extension point that makes "third parties are first-class" true
 * rather than aspirational. An Uplink publishing a topic the contract has never
 * seen calls this at module load, exactly as it would call `registerComponent`
 * or `registerTheme`, and its readouts then scale, round and label like a
 * first-party one.
 *
 * Without it an unknown symbol still renders, bare and unscaled, which is the
 * right FALLBACK and a poor ceiling: it means a third party cannot have a
 * ladder or a precision rule at all.
 *
 * Last registration wins, so an app may override a built-in deliberately. There
 * is no unregister: units are declared at module load and live for the session,
 * the same lifecycle every other registry here has.
 */
export function registerUnit(def: UnitDefinition): void {
  REGISTERED_KINDS[def.symbol] = def.kind;
  if (def.decimals !== undefined) DECIMALS[def.kind] = def.decimals;
  if (def.ladder) {
    LADDERS[def.kind] = def.ladder;
    // The derived rung index is now stale: a replaced ladder brings its own
    // symbols and drops the ones it replaced.
    rungKinds = undefined;
  }
  if (def.scientific) SCIENTIFIC.add(def.kind);
  if (def.display !== undefined) DISPLAY_BY_KIND[def.kind] = def.display;
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
    const conversion = CONVERSIONS[`${unit}→${opts.as}`];
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
    if (kind === "time") {
      return { value: formatDuration(value), symbol: "", rung: "s" };
    }

    // `irlTime` is the same ladder on a real day, and it is a SEPARATE kind
    // rather than an option on this one so the two cannot be handed to each
    // other by accident. A staleness badge and a mission clock sit side by
    // side in this UI, and the difference between them is a factor of four
    // that renders as a plausible number.
    if (kind === "irlTime") {
      return { value: formatIrlDuration(value), symbol: "", rung: "irl:s" };
    }
  }

  const ladder = opts.scale === "never" ? undefined : LADDERS[kind];
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

  // The declared unit is not necessarily the ladder's base. The contract
  // carries what KSP sends, and KSP sends tonnes and kN, so a field can arrive
  // already partway up its own ladder. Normalise to base before choosing a
  // rung, or the comparison comes out in the wrong dimension entirely: 5 t
  // measured against KILOGRAM thresholds falls to the bottom rung and renders
  // "5.00 kg", a 1000x error wearing a plausible label.
  const declared = ladder.find((r) => r.symbol === unit);
  const base = declared ? value * declared.per : value;

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

  return {
    value: fixed(base / chosen.per, decimals),
    symbol: chosen.symbol,
    rung: chosen.symbol,
  };
}
