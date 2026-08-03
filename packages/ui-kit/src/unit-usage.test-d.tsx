/**
 * What the unit system looks like from a widget, checked by `tsc`.
 *
 * Every block below is compiled by `tsconfig.test-d.json`. The ones marked
 * `@ts-expect-error` are compiled too, and `tsc` fails if any of them stops
 * erroring, so this file cannot rot into aspirational documentation: the
 * examples that should work do, and the mistakes that should be caught still
 * are.
 *
 * This exists because the migration ahead touches hundreds of readouts. A
 * reviewer should be able to see the whole surface on one screen before any of
 * that starts.
 */

import { UnitSystem } from "@ksp-gonogo/sitrep-sdk";
import { Unit } from "./Unit";

const { value } = UnitSystem;

// Stand-ins for what `useTelemetry` hands a widget once the wrap is wired.
// Post-flip these are the real field types, not constructions.
const altitude = value("m", 12_400);
const surfaceSpeed = value("m/s", 340);
const timeToApoapsis = value("s", 8_040);
const heatShieldFlux = value("kW", 3.4);
const funds = value("funds", 289_848);
const dryMass = value("t", 18.4);
const burnTime = value("s", 42);

// ── 1. The whole API ────────────────────────────────────────────────────────
// The call site names neither the unit nor the format. It cannot get either
// wrong because it does not participate.
export const _basic = <Unit value={altitude} />;

// ── 2. Presentation is asked for, never computed ────────────────────────────
export const _precision = <Unit value={heatShieldFlux} decimals={1} />;
export const _pinned = <Unit value={surfaceSpeed} format="km/h" />;
export const _celsius = <Unit value={value("K", 300)} as="°C" />;

// A format of the wrong kind is a type error, not a wrong number on screen.
// @ts-expect-error: seconds are not a speed
export const _wrongKind = <Unit value={surfaceSpeed} format="s" />;

// @ts-expect-error: not a unit of any kind
export const _notAUnit = <Unit value={altitude} format="furlongs" />;

// ── 3. Arithmetic and ordering carry the unit through ───────────────────────
// Same dimension adds, converting as it goes: 42s + 2min is one duration.
export const _totalBurn = burnTime.plus(value("min", 2));

// Different dimensions do not.
// @ts-expect-error: a mass is not a duration
export const _nonsense = dryMass.plus(burnTime);

// Division derives the unit rather than being told it.
export const _acceleration = surfaceSpeed.per(burnTime); // m/s²
export const _fuelFlow = dryMass.per(burnTime); // kg/s

// Ordering converts first, so the unit a value happens to be in does not
// decide the answer. Comparing `.magnitude` directly would: 2 h has a smaller
// magnitude than 120 s and is thirty times the duration.
export const _isLong = burnTime.greaterThan(value("min", 1));
export const _sorted = [burnTime, value("min", 2)].sort((a, b) => a.compare(b));

// Sign needs no operand: zero is zero in every unit of a dimension, and
// "is this rate a drain" is the most common comparison in the codebase.
export const _draining = value("units/s", -0.32).isNegative();
export const _drift = value("m", -14.2).abs();

// min/max convert first. Math.max via valueOf would compare 1 against 90 and
// return the 90 MINUTES, which is the shorter duration.
export const _longer = value("h", 1).max(value("min", 90));

// ── 4. What the migration will actually hit ─────────────────────────────────
// These are the compile errors that ARE the work list. Each one is a site
// where a number was being treated as a bare number and the unit was being
// carried in someone's head.

// @ts-expect-error: a Value is not a ReactNode. This is the {value} in JSX case.
export const _rawInJsx = <span>{altitude}</span>;

// @ts-expect-error: arithmetic on an object type
export const _rawMaths = altitude + 1;

// @ts-expect-error: relational operator on an object type
export const _rawCompare = altitude > 1_000;

// @ts-expect-error: toFixed belongs to Number.prototype, and formatting is Unit's job
export const _rawFormat = altitude.toFixed(2);

// The migrations for each, in order:
export const _fixedJsx = (
  <span>
    <Unit value={altitude} />
  </span>
);
export const _fixedMaths = altitude.plus(value("m", 1));
export const _fixedCompare = altitude.greaterThan(value("m", 1_000));
export const _fixedFormat = <Unit value={altitude} decimals={2} />;

// valueOf is still there for the places a number is genuinely wanted: a chart
// axis, a progress bar, Math.max.
export const _axisMax: number = Math.max(
  altitude.valueOf(),
  value("m", 5_000).valueOf(),
);

// ── 5. A duration is a unit like any other ──────────────────────────────────
// No formatDuration, no formatCountdown. Time climbs by 60 and 6 rather than
// by 1000, and Unit knows that because the value says it is a time.
export const _countdown = <Unit value={timeToApoapsis} />;

// ── 6. Currencies ───────────────────────────────────────────────────────────
// The glyph, the spoken word and the thousands separator all come from the
// model. A widget spending funds shows the balance; it does not format it.
export const _funds = <Unit value={funds} />;

// ── 7. A Vec3 leaf is a value ───────────────────────────────────────────────
// The unit is declared on the whole vector and reaches x/y/z, so a component
// of a relative velocity renders like any other quantity.
// NOT `Vec3Of<"m/s">`, and that is a finding rather than a shortcut. `Vec3Of`
// is declared beside the transitional `Value = number` alias and so is built
// from it, which means a Vec3 leaf is a bare number today and does not fit
// `Unit`. Both have to be re-pointed at the model together at the flip, and
// this is what a widget gets once they are.
declare const relativeVelocity: {
  x: UnitSystem.Value<"m/s">;
  y: UnitSystem.Value<"m/s">;
  z: UnitSystem.Value<"m/s">;
};
export const _vectorLeaf = <Unit value={relativeVelocity.x} />;

// @ts-expect-error: a whole vector is not a scalar quantity
export const _wholeVector = <Unit value={relativeVelocity} />;

// ── 8. An Uplink's own unit ─────────────────────────────────────────────────
// Namespaced, so it cannot collide with a first-party glyph. It is a full
// participant: it adds, divides and renders.
UnitSystem.registerUnit({
  symbol: "snacks:snack",
  kind: "snacks",
  dimension: { snack: 1 },
});
UnitSystem.registerUnit({
  symbol: "snacks:snack/s",
  kind: "snackFlow",
  of: "snacks:snack",
  per: "s",
});

const snacks = value("snacks:snack", 40);
export const _snackFlow = snacks.per(burnTime);
export const _snackReadout = <Unit value={snacks} />;

// @ts-expect-error: a snack is not a tonne, whatever the glyph looks like
export const _snacksPlusMass = snacks.plus(dryMass);
