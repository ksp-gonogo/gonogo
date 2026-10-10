import type { Dimension } from "./dimension";

/**
 * What the runtime knows about one unit, as {@link lookupUnit} returns it.
 *
 * @category Units and values
 */
export interface UnitDefinition {
  /** The dimension, as base units and their powers. Never holds a power of zero. */
  readonly dim: Dimension;
  /** How many of the dimension's base unit one of this unit is. `t` is 1000, since the base of mass is the kilogram. */
  readonly ratio: number;
  /**
   * What the value means, which the dimension alone may not say: torque and
   * energy share a dimension. It decides how the value is shown, never what
   * arithmetic is allowed.
   */
  readonly kind: string;
  /** Set for a logarithmic unit, such as decibels, which is never shown on a ladder. */
  readonly log?: true;
  /** The ladder the unit belongs to; see {@link UnitDeclaration.ladder}. */
  readonly ladder?: string;
  /**
   * Set for a second name of a dimension another unit already names. It
   * converts like any unit, but a computed value is never shown in it.
   */
  readonly alias?: true;
  /**
   * Set on a kind that names an instant, to the kind a difference of two of
   * them is: an instant minus an instant is a duration. See {@link PointUnit}.
   */
  readonly affineVector?: string;

  /**
   * The kind this one shares a dimension with but measures something
   * unrelated, such as energy and torque. Values of the two cannot be added,
   * subtracted, compared or converted into each other. They can still be
   * multiplied and divided, since a torque times an angle is work.
   */
  readonly coincidentWith?: string;
}

/*
 * Wider than the contract on purpose: W, J, N and Pa never cross the wire, but a computed power needs a name.
 * `as const` is load-bearing: the type layer reads dimensions from it, and widening it turns the compile-time gate off.
 */
/**
 * Standard gravity, 9.80665 m/s²: the value KSP uses for thrust-to-weight,
 * delta-v and g-force.
 *
 * @category Units and values
 */
export const STANDARD_GRAVITY = 9.80665;

/**
 * Every unit Gonogo itself defines, keyed by symbol. Units an Uplink
 * registers are not here; {@link lookupUnit} covers both.
 *
 * @category Units and values
 */
export const UNIT_DEFINITIONS = {
  // ── Length ───────────────────────────────────────────────────────────────
  /** Metres, the base of length. */
  m: { dim: { m: 1 }, ratio: 1, kind: "length", ladder: "length" },
  /** Kilometres. */
  km: { dim: { m: 1 }, ratio: 1_000, kind: "length", ladder: "length" },
  /** Megametres. */
  Mm: { dim: { m: 1 }, ratio: 1_000_000, kind: "length", ladder: "length" },
  /** Gigametres. */
  Gm: { dim: { m: 1 }, ratio: 1_000_000_000, kind: "length", ladder: "length" },
  /** Terametres. */
  Tm: { dim: { m: 1 }, ratio: 1e12, kind: "length", ladder: "length" },
  /** Square metres. */
  "m²": { dim: { m: 2 }, ratio: 1, kind: "area" },
  /** Cubic metres. */
  "m³": { dim: { m: 3 }, ratio: 1, kind: "volume" },

  // ── Time ─────────────────────────────────────────────────────────────────
  // A KSP day is 21600s (Kerbin), not 86400. Four widgets divided by the Earth
  // figure before a guard caught it; `d` exists so nobody has to write either.
  /** Seconds, the base of duration. */
  s: { dim: { s: 1 }, ratio: 1, kind: "time" },
  // An INSTANT, not an interval. Same dimension as `s` on purpose, so a UT
  // plus a duration is still a UT and the algebra keeps working; the `kind`
  // is what separates them, and `kind` never gates arithmetic (see this
  // field's own doc in `UnitDefinition`). It is what lets `<Countdown>` refuse
  // a UT while `<MissionDate>` demands one.
  // `alias` because `s` was registered first: a COMPUTED `{s:1}` renders as a
  // duration, which is right, since the only arithmetic that lands there is
  // one duration plus another, or one instant minus another. `ut` is a thing
  // the contract DECLARES a field to be, never something a calculation
  // produces.
  /** Universal time: an instant on the game clock, in seconds. A duration is `s`. */
  ut: {
    dim: { s: 1 },
    ratio: 1,
    kind: "universalTime",
    alias: true,
    affineVector: "time",
  },
  // A PERFORMANCE figure, not a length of time. Seconds by dimension, because
  // an exhaust velocity divided by standard gravity is seconds, and every
  // engine in the game is quoted this way; but nobody reads a 320 s engine as
  // five minutes and twenty seconds. Same construction as `ut` one entry up and
  // for the same reason: the dimension has to stay `{s:1}` so the algebra keeps
  // working, and the `kind` is what stops the duration ladder claiming it.
  // `alias` because `s` was registered first, and because no calculation
  // produces an Isp: it is a thing the contract DECLARES a field to be.
  /** Specific impulse, quoted in seconds but not a length of time. */
  isp: {
    dim: { s: 1 },
    ratio: 1,
    kind: "specificImpulse",
    alias: true,
  },
  /** Minutes, 60 seconds. */
  min: { dim: { s: 1 }, ratio: 60, kind: "time" },
  /** Hours, 3,600 seconds. */
  h: { dim: { s: 1 }, ratio: 3_600, kind: "time" },
  /** Game days, 21,600 seconds on Kerbin's calendar. */
  d: { dim: { s: 1 }, ratio: 21_600, kind: "time" },
  // The duration ladder's top tier. It renders in every mission clock that
  // runs past a Kerbin year, and having no entry here left it the one tier
  // symbol with no kind: `kindOfUnit("y")` answered `undefined`, so a field
  // declared in years missed the duration branch and rendered as a bare
  // number. Like `min`, `h` and `d` it is a display and arithmetic unit
  // rather than a contract token, and like them its size is the calendar's
  // to decide, not this table's.
  /** Game years, 426 game days. */
  y: { dim: { s: 1 }, ratio: 426 * 21_600, kind: "time" },

  // ── Speed ────────────────────────────────────────────────────────────────
  /** Metres per second, the base of speed. */
  "m/s": { dim: { m: 1, s: -1 }, ratio: 1, kind: "speed" },
  /** Kilometres per second. */
  "km/s": { dim: { m: 1, s: -1 }, ratio: 1_000, kind: "speed" },
  /** Kilometres per hour. */
  "km/h": { dim: { m: 1, s: -1 }, ratio: 1 / 3.6, kind: "speed" },

  // ── Angle ────────────────────────────────────────────────────────────────
  /** Radians, the base of plane angle. */
  rad: { dim: { rad: 1 }, ratio: 1, kind: "planeAngle" },
  /** Degrees. */
  "°": { dim: { rad: 1 }, ratio: Math.PI / 180, kind: "planeAngle" },
  /** Revolutions per minute, an angular speed. */
  rpm: {
    dim: { rad: 1, s: -1 },
    ratio: (2 * Math.PI) / 60,
    kind: "angularSpeed",
  },
  /*
   * Angle per second at base scale: what a mean motion is, and what
   * `rad.per(s)` produces. No payload carries one. Spelled with the exponent
   * because `rad/s` is the dose rate below. This entry has to exist: with no
   * ratio-1 unit of its own, a computed angular speed is named after its
   * dimension, which spells `rad/s` and so reads back as a dose.
   */
  /** Radians per second, the base of angular speed; what a mean motion is. */
  "rad·s⁻¹": { dim: { rad: 1, s: -1 }, ratio: 1, kind: "angularSpeed" },

  // ── Mass, force, energy, power, pressure ─────────────────────────────────
  /** Kilograms, the base of mass. */
  kg: { dim: { kg: 1 }, ratio: 1, kind: "mass", ladder: "mass" },
  // Propellant consumption. Declared outright rather than left to decompose out
  // of mass-per-time, so it renders under its own kind instead of borrowing
  // whichever kind the algebra happened to reach for.
  /** Kilograms per second, a mass flow such as propellant consumption. */
  "kg/s": { dim: { kg: 1, s: -1 }, ratio: 1, kind: "massFlow" },
  /** Tonnes, 1,000 kilograms. */
  t: { dim: { kg: 1 }, ratio: 1_000, kind: "mass", ladder: "mass" },
  // The astronomical rungs are GRAM-based symbols on a KILOGRAM base: 1 Yg is
  // 1e24 g, which is 1e21 kg. Stating the ratio in kg is not a convenience, it
  // makes a real bug unrepresentable, and it is the bug SystemView shipped:
  // gram thresholds applied to a kilogram value labelled Kerbin one whole
  // prefix tier too small.
  /** Kilotonnes. */
  kt: { dim: { kg: 1 }, ratio: 1e6, kind: "mass", ladder: "mass" },
  /** Teragrams, a million tonnes. */
  Tg: { dim: { kg: 1 }, ratio: 1e9, kind: "mass", ladder: "mass" },
  /** Petagrams. */
  Pg: { dim: { kg: 1 }, ratio: 1e12, kind: "mass", ladder: "mass" },
  /** Exagrams. */
  Eg: { dim: { kg: 1 }, ratio: 1e15, kind: "mass", ladder: "mass" },
  /** Zettagrams. */
  Zg: { dim: { kg: 1 }, ratio: 1e18, kind: "mass", ladder: "mass" },
  /** Yottagrams. */
  Yg: { dim: { kg: 1 }, ratio: 1e21, kind: "mass", ladder: "mass" },
  /** Newtons, the base of force. */
  N: { dim: { kg: 1, m: 1, s: -2 }, ratio: 1, kind: "force", ladder: "force" },
  /** Kilonewtons. */
  kN: {
    dim: { kg: 1, m: 1, s: -2 },
    ratio: 1_000,
    kind: "force",
    ladder: "force",
  },
  /** Meganewtons. */
  MN: {
    dim: { kg: 1, m: 1, s: -2 },
    ratio: 1e6,
    kind: "force",
    ladder: "force",
  },
  /** Joules, the base of energy. */
  J: {
    dim: { kg: 1, m: 2, s: -2 },
    ratio: 1,
    kind: "energy",
    coincidentWith: "torque",
  },
  // Same dimension as J, different quantity, so the two are declared
  // COINCIDENTAL and refuse each other additively. `force.times(distance)`
  // still lands here: `times` is deliberately outside the refusal, because a
  // torque times an angle is work. `format="N·m"` is how a torque keeps
  // reading as a torque.
  // `alias` because J was registered first and is what a computed
  // {kg:1,m:2,s:-2} renders as; see the flag's own doc on UnitDefinition.
  /*
   * U+00B7 is an identifier character only from ES2015 on, so how this name is
   * spelled in the emitted declarations decides whether a consumer on a lower
   * target can parse them. Quoting it here does not carry: this table's type is
   * synthesised, so tsc regenerates the name, and the formatter unquotes it
   * again. `scripts/quote-downlevel-declaration-names.mjs` is what settles it.
   */
  /** Newton metres, torque. Shares a dimension with energy but cannot be added to it. */
  N·m: {
    dim: { kg: 1, m: 2, s: -2 },
    ratio: 1,
    kind: "torque",
    alias: true,
    coincidentWith: "energy",
  },
  /** Watts, the base of power. */
  W: { dim: { kg: 1, m: 2, s: -3 }, ratio: 1, kind: "power", ladder: "power" },
  // A declared alias for the same dimension. It parses, and it never renders:
  // the ratio-1 entry registered first (W) is what a computed power shows as.
  /** Joules per second, a second name for watts that is never shown. */
  "J/s": {
    dim: { kg: 1, m: 2, s: -3 },
    ratio: 1,
    kind: "power",
    alias: true,
    ladder: "power",
  },
  /** Kilowatts. */
  kW: {
    dim: { kg: 1, m: 2, s: -3 },
    ratio: 1_000,
    kind: "power",
    ladder: "power",
  },
  // Descends below the base unit: the upper atmosphere runs to fractions of a pascal.
  /** Millipascals, for the thinnest air. */
  mPa: {
    dim: { kg: 1, m: -1, s: -2 },
    ratio: 1e-3,
    kind: "pressure",
    ladder: "pressure",
  },
  /** Pascals, the base of pressure. */
  Pa: {
    dim: { kg: 1, m: -1, s: -2 },
    ratio: 1,
    kind: "pressure",
    ladder: "pressure",
  },
  /** Kilopascals. */
  kPa: {
    dim: { kg: 1, m: -1, s: -2 },
    ratio: 1_000,
    kind: "pressure",
    ladder: "pressure",
  },
  // Descends below the base unit for the same reason mPa does: air density falls from about a kilogram per cubic metre at sea level to grams and less.
  /** Grams per cubic metre, for thin air. */
  "g/m³": {
    dim: { kg: 1, m: -3 },
    ratio: 1e-3,
    kind: "density",
    ladder: "density",
  },
  /** Kilograms per cubic metre, the base of density. */
  "kg/m³": {
    dim: { kg: 1, m: -3 },
    ratio: 1,
    kind: "density",
    ladder: "density",
  },
  // Multiples of standard gravity, the convention KSP's own geeForce reports.
  /** Multiples of standard gravity, as KSP reports g-force. */
  g: { dim: { m: 1, s: -2 }, ratio: STANDARD_GRAVITY, kind: "acceleration" },
  /** Metres per second squared, the base of acceleration. */
  "m/s²": { dim: { m: 1, s: -2 }, ratio: 1, kind: "acceleration" },
  /** Cubic metres per second squared, the unit of a gravitational parameter. */
  "m³/s²": { dim: { m: 3, s: -2 }, ratio: 1, kind: "gravParameter" },
  /** Watts per square metre, irradiance. */
  "W/m²": { dim: { kg: 1, s: -3 }, ratio: 1, kind: "irradiance" },

  // ── Temperature ──────────────────────────────────────────────────────────
  // Kelvin only. Celsius is a PRESENTATION unit the client asks for by name;
  // leaving the token out means the mistake cannot be spelled.
  /** Kelvin, the only temperature unit; Celsius is a presentation choice. */
  K: { dim: { K: 1 }, ratio: 1, kind: "temperature" },

  // ── Data, level, radiation ───────────────────────────────────────────────
  /**
   * The BASE of the data dimension, and the only data unit core declares.
   *
   * Rungs and families belong to whoever models them: an antenna mod deals in
   * bits and a life-support mod in bytes, and neither has to know the other
   * exists. What they cannot do is agree on an axis by accident. `Dimension`
   * is an open string map, so a mod writing `{ bits: 1 }` instead of
   * `{ bit: 1 }` would silently get a separate dimension, and a file size
   * would stop being convertible with a link budget with nothing going red.
   * Declaring the base here makes the axis name authoritative and spellable
   * rather than a convention every mod retypes.
   *
   * Rates are not declared anywhere: `bit/s` and friends compose at lookup
   * time from a data unit and `s`, so a family gets its per-second forms for
   * free rather than one atom per rung.
   */
  bit: { dim: { bit: 1 }, ratio: 1, kind: "data", ladder: "data" },
  // The one rate core declares, so the data-rate dimension has a name to
  // render as. Rungs above it belong to whoever models them.
  /** Bits per second, the data rate. */
  "bit/s": {
    dim: { bit: 1, s: -1 },
    ratio: 1,
    kind: "dataRate",
    ladder: "dataRate",
  },
  /** Mits, KSP's own unit of science data volume. */
  Mit: { dim: { Mit: 1 }, ratio: 1, kind: "scienceData" },
  /** Decibels, a logarithmic level that is never prefix-scaled. */
  dB: { dim: { dB: 1 }, ratio: 1, kind: "level", log: true },
  // Absorbed dose. Its base is `radDose`, NOT the `rad` of plane angle: they
  // are unrelated quantities that collide on a glyph. Declaring the compound
  // outright is what stops it decomposing into angle-per-second, which is a
  // real dimension (rpm's) and would have compared equal.
  /** Absorbed radiation dose per second, as the mod reports it. Unrelated to the angle unit radian. */
  "rad/s": {
    dim: { radDose: 1, s: -1 },
    ratio: 1,
    kind: "doseRate",
    ladder: "doseRate",
  },
  // The scale a dose rate is READ at. The mod reports rad/s; an operator reads
  // rad/h, and that conversion was a bare `* 3600` at the one widget that
  // needed it. Same dimension, different scale, which is what `ratio` is for.
  /** Absorbed radiation dose per hour, the scale an operator reads. */
  "rad/h": {
    dim: { radDose: 1, s: -1 },
    ratio: 1 / 3600,
    kind: "doseRate",
    ladder: "doseRate",
  },

  // ── Career currencies ────────────────────────────────────────────────────
  // Three separate bases, not one "amount": they are not interchangeable, and a
  // formatter that treats reputation like funds thousands-separates a number
  // that never exceeds a few hundred.
  /** Career funds. */
  funds: { dim: { funds: 1 }, ratio: 1, kind: "funds" },
  /** Career science points. */
  science: { dim: { science: 1 }, ratio: 1, kind: "science" },
  // Per GAME-day, so the ratio is Kerbin's 21600s.
  /** Science points per game day. */
  "science/day": {
    dim: { science: 1, s: -1 },
    ratio: 1 / 21_600,
    kind: "scienceRate",
  },
  /** Career reputation. */
  rep: { dim: { rep: 1 }, ratio: 1, kind: "reputation" },
  // Money and standing as RATES, for the career models that make them flow
  // rather than sit: a funding subsidy arriving and a standing cost leaving,
  // both continuously, and a reputation that falls a little every day.
  //
  // Same game-day denominator, and the same caveat, as `science/day` above: the
  // ratio here is Kerbin's day because the calendar is a property of the
  // install rather than of the token, and a solar-system replacement moves it
  // to 86400s. The number an operator READS is per day either way; only a
  // conversion into another unit of this dimension is out, by the ratio of the
  // two calendars.
  // Spelled with the funds SYMBOL, like `rep/day` below it: `f` is what a
  // balance renders as, and a rate that spelled the dimension out made the same
  // quantity read two ways ("289,848f" against "980.0 funds/day").
  /** Funds per game day. */
  "f/day": {
    dim: { funds: 1, s: -1 },
    ratio: 1 / 21_600,
    kind: "fundsRate",
  },
  /** Reputation per game day. */
  "rep/day": {
    dim: { rep: 1, s: -1 },
    ratio: 1 / 21_600,
    kind: "reputationRate",
  },

  // ── Non-physical, but still quantities ───────────────────────────────────
  // A count is its own base. Adding three crew to a 0.5 ratio is nonsense, and
  // collapsing them into dimensionless is what would have allowed it.
  /** A whole number of things, its own base so it cannot be added to a ratio. */
  count: { dim: { count: 1 }, ratio: 1, kind: "count" },
  /** Units of a resource, as the game counts them. */
  units: { dim: { resource: 1 }, ratio: 1, kind: "resourceUnits" },
  /** Units of a resource per second. */
  "units/s": { dim: { resource: 1, s: -1 }, ratio: 1, kind: "resourceFlow" },

  // Dimensionless, three ways. All add correctly to each other, and each
  // renders differently: a ratio is x100 with a %, a percentage must never be,
  // and a dimensionless number is shown bare. Confusing ratio and percent
  // yields either 0.62% or 6250%, both plausible enough on screen to go
  // unnoticed, which is why they are separate.
  /** A dimensionless number, shown bare. */
  "1": { dim: {}, ratio: 1, kind: "dimensionless" },
  // `alias` because "1" was registered first: `m.per(m)` renders as `1`.
  /** A fraction, drawn multiplied by 100 with a percent sign. */
  ratio: { dim: {}, ratio: 1, kind: "ratio", alias: true },
  /** A percentage already multiplied by 100. */
  "%": { dim: {}, ratio: 0.01, kind: "percent" },

  // ── Real time, a DIFFERENT dimension from game time ──────────────────────
  // A second is a second, but the calendars diverge above an hour: a KSP day
  // is 6h and a real one is 24h. Kind cannot hold that distinction, because
  // kind does not gate arithmetic, so game seconds and real seconds would add.
  // Its own base symbol is what makes that an error.
  //
  // The `irl:` prefix is an internal key, never a rendered glyph: an IRL
  // duration displays as "s" / "min" / "h" / "d" like any other, and what
  // differs is what it will combine with. "In one hour IRL, how much game time
  // passes?" is realDuration.times(warpRate), not an addition, and forbidding
  // the addition is what stops an answer that is only right at 1x warp.
  /** Real-world seconds, a different dimension from game seconds. */
  "irl:s": { dim: { irlS: 1 }, ratio: 1, kind: "irlTime" },
  /** Real-world minutes. */
  "irl:min": { dim: { irlS: 1 }, ratio: 60, kind: "irlTime" },
  /** Real-world hours. */
  "irl:h": { dim: { irlS: 1 }, ratio: 60 * 60, kind: "irlTime" },
  // Written as hours rather than as a literal because the literal is the one
  // this codebase gets wrong: a KSP day is 21,600s and `styleguide-earth-day`
  // exists to catch the 86,400 that a hand reaches for. THIS is the one place
  // the 24-hour day is the right answer, and spelling it out says why.
  /** Real-world days of 24 hours. */
  "irl:d": { dim: { irlS: 1 }, ratio: 24 * 60 * 60, kind: "irlTime" },
} as const satisfies Record<string, UnitDefinition>;

/**
 * The symbol of a unit Gonogo itself defines.
 *
 * @category Units and values
 */
export type KnownUnit = keyof typeof UNIT_DEFINITIONS;
