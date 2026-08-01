import { formatDuration } from "./formatDuration";
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
  | "angle"
  | "energyRate"
  | "dataRate"
  | "doseRate"
  | "irradiance"
  | "level"
  | "density"
  | "gravitationalParameter"
  | "dimensionless"
  | "percentage"
  | "scienceData"
  | "fraction";

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
 *  - `gravitationalParameter`, whose values are ~1e12 and have no named
 *    prefixes anyone uses. Scientific notation instead: see `SCIENTIFIC`.
 *  - `angle`, `fraction`, `dimensionless`, which have no magnitudes to climb.
 */
const LADDERS: Record<string, readonly Rung[]> = {
  length: [
    { from: 0, symbol: "m", per: 1 },
    { from: 1e3, symbol: "km", per: 1e3 },
    { from: 1e6, symbol: "Mm", per: 1e6 },
    { from: 1e9, symbol: "Gm", per: 1e9 },
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
const SCIENTIFIC = new Set<string>(["gravitationalParameter"]);

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
  angle: 2,
  density: 4,
  dataRate: 1,
  doseRate: 4,
  irradiance: 1,
  level: 1,
  dimensionless: 2,
  percentage: 1,
  scienceData: 1,
  fraction: 0,
};

/** The contract's unit symbols, mapped to what they measure. */
const KIND_BY_SYMBOL: Record<string, QuantityKind> = {
  m: "length",
  "m/s": "speed",
  "m/s²": "acceleration",
  g: "acceleration",
  kg: "mass",
  t: "mass",
  N: "force",
  kN: "force",
  Pa: "pressure",
  kPa: "pressure",
  K: "temperature",
  "°C": "temperature",
  s: "time",
  "°": "angle",
  rad: "angle",
  kW: "energyRate",
  "bit/s": "dataRate",
  "kbit/s": "dataRate",
  "Mbit/s": "dataRate",
  "Gbit/s": "dataRate",
  dB: "level",
  "rad/s": "doseRate",
  "W/m²": "irradiance",
  "kg/m³": "density",
  "m³/s²": "gravitationalParameter",
  "1": "dimensionless",
  ratio: "fraction",
  "%": "percentage",
  Mit: "scienceData",
};

/** What a unit symbol measures, or undefined for one we do not know. */
export function kindOfUnit(
  symbol: string | undefined,
): QuantityKind | undefined {
  return symbol === undefined ? undefined : KIND_BY_SYMBOL[symbol];
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
  /** Render in scientific notation by default, as `gravitationalParameter` does. */
  scientific?: boolean;
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
  KIND_BY_SYMBOL[def.symbol] = def.kind;
  if (def.decimals !== undefined) DECIMALS[def.kind] = def.decimals;
  if (def.ladder) LADDERS[def.kind] = def.ladder;
  if (def.scientific) SCIENTIFIC.add(def.kind);
}

export interface FormatQuantityOptions {
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

  // A fraction is 0..1 and shown as a percentage; a percentage that is already
  // 0..100 is a different unit and must not be multiplied again. Keeping them
  // distinct is the single most common unit bug in a dashboard.
  if (kind === "fraction") {
    const decimals = opts.decimals ?? DECIMALS.fraction ?? 0;
    return { value: (value * 100).toFixed(decimals), symbol: "%", rung: "%" };
  }

  // An undeclared unit renders bare rather than guessed at. "1" is explicitly
  // dimensionless, which is not the same as absent, and also renders bare.
  if (unit === undefined || unit === "1" || kind === undefined) {
    const decimals = opts.decimals ?? (kind ? DECIMALS[kind] : undefined);
    return {
      value: decimals === undefined ? String(value) : value.toFixed(decimals),
      symbol: unit === undefined || unit === "1" ? "" : unit,
      rung: unit ?? "",
    };
  }

  // `"never"` means "give me the plain base-unit number", so it opts out of the
  // composite and scientific presentations as well as the ladder. A caller that
  // wants to do its own arithmetic on the string needs that escape hatch.
  if (opts.scale !== "never") {
    if (opts.scale === "scientific" || SCIENTIFIC.has(kind)) {
      return {
        value: toScientific(
          value,
          opts.decimals === undefined
            ? SCIENTIFIC_SIGNIFICANT
            : opts.decimals + 1,
        ),
        symbol: unit,
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
  }

  const ladder = opts.scale === "never" ? undefined : LADDERS[kind];
  const decimals = opts.decimals ?? DECIMALS[kind] ?? 2;

  if (!ladder) {
    return { value: value.toFixed(decimals), symbol: unit, rung: unit };
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
    value: (base / chosen.per).toFixed(decimals),
    symbol: chosen.symbol,
    rung: chosen.symbol,
  };
}
