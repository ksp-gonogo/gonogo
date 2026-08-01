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
export type QuantityKind =
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
  | "density"
  | "gravitationalParameter"
  | "dimensionless"
  | "fraction";

/** One rung of a scaling ladder: a threshold in base units and its symbol. */
interface Rung {
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
 *    a Celsius display would be an OFFSET conversion, which a ladder cannot
 *    express.
 *  - `angle`, `fraction`, `dimensionless`, which have no magnitudes to climb.
 */
const LADDERS: Partial<Record<QuantityKind, readonly Rung[]>> = {
  length: [
    { from: 0, symbol: "m", per: 1 },
    { from: 1e3, symbol: "km", per: 1e3 },
    { from: 1e6, symbol: "Mm", per: 1e6 },
    { from: 1e9, symbol: "Gm", per: 1e9 },
  ],
  mass: [
    { from: 0, symbol: "kg", per: 1 },
    { from: 1e3, symbol: "t", per: 1e3 },
    { from: 1e6, symbol: "kt", per: 1e6 },
  ],
  force: [
    { from: 0, symbol: "N", per: 1 },
    { from: 1e3, symbol: "kN", per: 1e3 },
    { from: 1e6, symbol: "MN", per: 1e6 },
  ],
  pressure: [
    { from: 0, symbol: "Pa", per: 1 },
    { from: 1e3, symbol: "kPa", per: 1e3 },
    { from: 1e6, symbol: "MPa", per: 1e6 },
  ],
};

/**
 * How much precision a kind is read at, as decimal places on the SCALED value.
 *
 * Per kind rather than per magnitude, so a readout holds a stable digit count
 * as the value moves. An instrument whose width changes every frame reads as a
 * fault, which is also why anything live should render in tabular numerals.
 */
const DECIMALS: Partial<Record<QuantityKind, number>> = {
  length: 1,
  speed: 1,
  acceleration: 2,
  mass: 2,
  force: 1,
  pressure: 2,
  temperature: 0,
  angle: 2,
  density: 4,
  dimensionless: 2,
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
  "kg/m³": "density",
  "m³/s²": "gravitationalParameter",
  "1": "dimensionless",
  ratio: "fraction",
};

/** What a unit symbol measures, or undefined for one we do not know. */
export function kindOfUnit(
  symbol: string | undefined,
): QuantityKind | undefined {
  return symbol === undefined ? undefined : KIND_BY_SYMBOL[symbol];
}

export interface FormatQuantityOptions {
  /**
   * `"auto"` climbs the kind's ladder, `"never"` holds the base unit. Defaults
   * to auto where a ladder exists.
   */
  scale?: "auto" | "never";
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

  const ladder = opts.scale === "never" ? undefined : LADDERS[kind];
  const decimals = opts.decimals ?? DECIMALS[kind] ?? 2;

  if (!ladder) {
    return { value: value.toFixed(decimals), symbol: unit, rung: unit };
  }

  const magnitude = Math.abs(value);
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
    value: (value / chosen.per).toFixed(decimals),
    symbol: chosen.symbol,
    rung: chosen.symbol,
  };
}
