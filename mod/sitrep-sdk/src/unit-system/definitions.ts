import type { Dimension } from "./dimension";

/**
 * What a declared unit knows about itself.
 *
 * `ratio` converts to the dimension's BASE, which is what makes
 * `Value("h", 2).plus(Value("s", 120))` correct without anyone writing a
 * conversion. It is not a display decision: which rung a value renders at is
 * ui-kit's business, and lives there.
 */
export interface UnitDefinition {
  /** Exponent map over base symbols. Never carries a zero exponent. */
  readonly dim: Dimension;
  /** Multiplier onto the dimension's base unit. `t` is 1000 (kilograms). */
  readonly ratio: number;
  /**
   * What the value MEANS, as opposed to what it measures. Torque and energy
   * share a dimension; `count` and `ratio` are both dimensionless. Kind never
   * gates arithmetic, it only drives display.
   */
  readonly kind: string;
  /**
   * Logarithmic, so it must never be prefix-scaled. "3.2 kdB" is not a thing,
   * and a ladder applied to a log scale is wrong rather than merely ugly.
   */
  readonly log?: true;
}

/**
 * Every unit the SDK knows, wire token or not.
 *
 * The C# contract declares only what crosses the wire. This table is wider on
 * purpose: `W`, `J`, `N` and `Pa` never appear in a payload, but `kW ÷ 1000` has
 * to land somewhere and a computed power has to have a name. Base units belong
 * to the model, not to the wire.
 *
 * `as const` is load-bearing. The type layer reads dimensions straight out of
 * this object to decide whether `plus` is allowed, so widening any of it to
 * `Record<string, UnitDefinition>` would silently turn the compile-time gate
 * off while leaving the runtime one in place. `satisfies` gets the checking
 * without the widening.
 */
export const UNIT_DEFINITIONS = {
  // ── Length ───────────────────────────────────────────────────────────────
  m: { dim: { m: 1 }, ratio: 1, kind: "length" },
  km: { dim: { m: 1 }, ratio: 1_000, kind: "length" },
  Mm: { dim: { m: 1 }, ratio: 1_000_000, kind: "length" },
  Gm: { dim: { m: 1 }, ratio: 1_000_000_000, kind: "length" },
  Tm: { dim: { m: 1 }, ratio: 1e12, kind: "length" },
  "m²": { dim: { m: 2 }, ratio: 1, kind: "area" },
  "m³": { dim: { m: 3 }, ratio: 1, kind: "volume" },

  // ── Time ─────────────────────────────────────────────────────────────────
  // A KSP day is 21600s (Kerbin), not 86400. Four widgets divided by the Earth
  // figure before a guard caught it; `d` exists so nobody has to write either.
  s: { dim: { s: 1 }, ratio: 1, kind: "time" },
  min: { dim: { s: 1 }, ratio: 60, kind: "time" },
  h: { dim: { s: 1 }, ratio: 3_600, kind: "time" },
  d: { dim: { s: 1 }, ratio: 21_600, kind: "time" },

  // ── Speed ────────────────────────────────────────────────────────────────
  "m/s": { dim: { m: 1, s: -1 }, ratio: 1, kind: "speed" },
  "km/s": { dim: { m: 1, s: -1 }, ratio: 1_000, kind: "speed" },
  "km/h": { dim: { m: 1, s: -1 }, ratio: 1 / 3.6, kind: "speed" },

  // ── Angle ────────────────────────────────────────────────────────────────
  rad: { dim: { rad: 1 }, ratio: 1, kind: "planeAngle" },
  "°": { dim: { rad: 1 }, ratio: Math.PI / 180, kind: "planeAngle" },
  rpm: {
    dim: { rad: 1, s: -1 },
    ratio: (2 * Math.PI) / 60,
    kind: "angularSpeed",
  },

  // ── Mass, force, energy, power, pressure ─────────────────────────────────
  kg: { dim: { kg: 1 }, ratio: 1, kind: "mass" },
  t: { dim: { kg: 1 }, ratio: 1_000, kind: "mass" },
  N: { dim: { kg: 1, m: 1, s: -2 }, ratio: 1, kind: "force" },
  kN: { dim: { kg: 1, m: 1, s: -2 }, ratio: 1_000, kind: "force" },
  J: { dim: { kg: 1, m: 2, s: -2 }, ratio: 1, kind: "energy" },
  // Same dimension as J, different meaning. Adding a torque to an energy is
  // meaningless but harmless, and it is ALLOWED: gating on kind cannot name the
  // kind of `force.times(distance)`, which is this exact map. `format="N·m"` is
  // how a torque keeps reading as a torque.
  N·m: { dim: { kg: 1, m: 2, s: -2 }, ratio: 1, kind: "torque" },
  W: { dim: { kg: 1, m: 2, s: -3 }, ratio: 1, kind: "power" },
  // A declared alias for the same dimension. It parses, and it never renders:
  // the ratio-1 entry registered first (W) is what a computed power shows as.
  "J/s": { dim: { kg: 1, m: 2, s: -3 }, ratio: 1, kind: "power" },
  kW: { dim: { kg: 1, m: 2, s: -3 }, ratio: 1_000, kind: "power" },
  Pa: { dim: { kg: 1, m: -1, s: -2 }, ratio: 1, kind: "pressure" },
  kPa: { dim: { kg: 1, m: -1, s: -2 }, ratio: 1_000, kind: "pressure" },
  "kg/m³": { dim: { kg: 1, m: -3 }, ratio: 1, kind: "density" },
  // Multiples of standard gravity, the convention KSP's own geeForce reports.
  g: { dim: { m: 1, s: -2 }, ratio: 9.80665, kind: "acceleration" },
  "m/s²": { dim: { m: 1, s: -2 }, ratio: 1, kind: "acceleration" },
  "m³/s²": { dim: { m: 3, s: -2 }, ratio: 1, kind: "gravParameter" },
  "W/m²": { dim: { kg: 1, s: -3 }, ratio: 1, kind: "irradiance" },

  // ── Temperature ──────────────────────────────────────────────────────────
  // Kelvin only. Celsius is a PRESENTATION unit the client asks for by name;
  // leaving the token out means the mistake cannot be spelled.
  K: { dim: { K: 1 }, ratio: 1, kind: "temperature" },

  // ── Data, level, radiation ───────────────────────────────────────────────
  bit: { dim: { bit: 1 }, ratio: 1, kind: "data" },
  "bit/s": { dim: { bit: 1, s: -1 }, ratio: 1, kind: "dataRate" },
  Mit: { dim: { Mit: 1 }, ratio: 1, kind: "scienceData" },
  dB: { dim: { dB: 1 }, ratio: 1, kind: "level", log: true },
  // Absorbed dose. Its base is `radDose`, NOT the `rad` of plane angle: they
  // are unrelated quantities that collide on a glyph. Declaring the compound
  // outright is what stops it decomposing into angle-per-second, which is a
  // real dimension (rpm's) and would have compared equal.
  "rad/s": { dim: { radDose: 1, s: -1 }, ratio: 1, kind: "doseRate" },

  // ── Career currencies ────────────────────────────────────────────────────
  // Three separate bases, not one "amount": they are not interchangeable, and a
  // formatter that treats reputation like funds thousands-separates a number
  // that never exceeds a few hundred.
  funds: { dim: { funds: 1 }, ratio: 1, kind: "funds" },
  science: { dim: { science: 1 }, ratio: 1, kind: "science" },
  // Per GAME-day, so the ratio is Kerbin's 21600s.
  "science/day": {
    dim: { science: 1, s: -1 },
    ratio: 1 / 21_600,
    kind: "scienceRate",
  },
  rep: { dim: { rep: 1 }, ratio: 1, kind: "reputation" },

  // ── Non-physical, but still quantities ───────────────────────────────────
  // A count is its own base. Adding three crew to a 0.5 ratio is nonsense, and
  // collapsing them into dimensionless is what would have allowed it.
  count: { dim: { count: 1 }, ratio: 1, kind: "count" },
  units: { dim: { resource: 1 }, ratio: 1, kind: "resourceUnits" },
  "units/s": { dim: { resource: 1, s: -1 }, ratio: 1, kind: "resourceFlow" },

  // Dimensionless, three ways. All add correctly to each other, and each
  // renders differently: a ratio is x100 with a %, a percentage must never be,
  // and a dimensionless number is shown bare. Confusing ratio and percent
  // yields either 0.62% or 6250%, both plausible enough on screen to go
  // unnoticed, which is why they are separate.
  "1": { dim: {}, ratio: 1, kind: "dimensionless" },
  ratio: { dim: {}, ratio: 1, kind: "ratio" },
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
  "irl:s": { dim: { irlS: 1 }, ratio: 1, kind: "irlTime" },
  "irl:min": { dim: { irlS: 1 }, ratio: 60, kind: "irlTime" },
  "irl:h": { dim: { irlS: 1 }, ratio: 60 * 60, kind: "irlTime" },
  // Written as hours rather than as a literal because the literal is the one
  // this codebase gets wrong: a KSP day is 21,600s and `styleguide-earth-day`
  // exists to catch the 86,400 that a hand reaches for. THIS is the one place
  // the 24-hour day is the right answer, and spelling it out says why.
  "irl:d": { dim: { irlS: 1 }, ratio: 24 * 60 * 60, kind: "irlTime" },
} as const satisfies Record<string, UnitDefinition>;

export type KnownUnit = keyof typeof UNIT_DEFINITIONS;
