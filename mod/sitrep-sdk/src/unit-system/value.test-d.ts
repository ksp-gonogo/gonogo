// Type-level tests for the value model.
//
// Enforced by `tsc` via `tsconfig.test-d.json`, the same gate `topics.test-d.ts`
// and `units.test-d.ts` use, and for the same reason: what is being pinned here
// is what FAILS to compile, which no runtime assertion can reach.
//
// The runtime throws too, and the two are not redundant. The throw is the net
// for a value whose unit is only known at runtime (an Uplink's symbol, a
// decoded payload); the compile error is what turns a mistake in hand-written
// code into a red squiggle instead of a crash in flight.

import { type UnknownUnit, type Value, value } from "./value";

const watts = value("W", 5);
const joulesPerSecond = value("J/s", 3);
const newtonMetres = value("N·m", 5);
const joules = value("J", 3);
const metres = value("m", 5);
const seconds = value("s", 35);
const hours = value("h", 2);

// ── Same dimension, different name: allowed ─────────────────────────────────
export const _wattsPlusJoulesPerSecond = watts.plus(joulesPerSecond);

// ── Same dimension, COINCIDENTAL kinds: refused ─────────────────────────────
// Energy and torque share {kg:1,m:2,s:-2} while measuring unrelated quantities,
// and both declare `coincidentWith`. Adding them was legal until that landed.
// @ts-expect-error: a torque and an energy are not the same quantity
export const _torquePlusEnergy = newtonMetres.plus(joules);
// @ts-expect-error: and refused from the other side, since both sides declare it
export const _energyPlusTorque = joules.plus(newtonMetres);
// @ts-expect-error: converting between them is not a change of scale
export const _energyAsTorque = joules.in("N·m");
// @ts-expect-error: nor is there an ordering between them
export const _energyUnderTorque = joules.lessThan(newtonMetres);

// Multiplication and division are deliberately NOT refused: a torque times an
// angle is work, and an energy over a torque is the angle swept. Both stay.
export const _torqueTimesAngle = newtonMetres.times(2);
export const _energyOverTorque = joules.dividedBy(newtonMetres);

// ── Same dimension, different scale: allowed, and converts ──────────────────
export const _hoursPlusSeconds = hours.plus(seconds);

// ── Different dimension: rejected ───────────────────────────────────────────
// @ts-expect-error: length and time are not the same dimension
export const _metresPlusSeconds = metres.plus(seconds);

// @ts-expect-error: power and temperature are not the same dimension
export const _wattsPlusKelvin = watts.plus(value("K", 300));

// @ts-expect-error: a count is its own base, not dimensionless
export const _countPlusRatio = value("count", 3).plus(value("ratio", 0.5));

// @ts-expect-error: absorbed dose rate is not angular velocity
export const _doseRatePlusRpm = value("rad/s", 1).plus(value("rpm", 1));

// ── The operators stay broken, which is the point ───────────────────────────
// TypeScript rejects these on object types regardless of `valueOf`, and each
// one is a migration site rather than a nuisance: `120 + 2 = 122` across a
// Value<"s"> and a Value<"h"> would otherwise look fine.

// @ts-expect-error: arithmetic on an object type
export const _added = metres + metres;

// @ts-expect-error: relational operator on an object type
export const _compared = metres > seconds;

// ── But valueOf still serves the places a number is genuinely wanted ────────
export const _max: number = Math.max(
  watts.valueOf(),
  joulesPerSecond.valueOf(),
);

// ── times / dividedBy are total ─────────────────────────────────────────────
export const _reputationPerFund = value("rep", 10).dividedBy(value("funds", 1));
export const _acceleration = metres.per(seconds).per(seconds);

// ── `in` converts only within a dimension ──────────────────────────────────
export const _hoursAsSeconds = hours.in("s");

// @ts-expect-error: cannot re-express a duration as a length
export const _hoursAsMetres = hours.in("m");

// ── Real time is a different DIMENSION, not a different kind ────────────────
// Kind does not gate arithmetic, so a kind-level split would have let these
// add: both would be {s: 1}. Its own base symbol is what makes it an error.
const gameSeconds = value("s", 60);
const irlSeconds = value("irl:s", 60);
const kspDay = value("d", 1);
const irlDay = value("irl:d", 1);

// @ts-expect-error: a real second and a game second are not the same dimension
export const _gameSecondsPlusIrlSeconds = gameSeconds.plus(irlSeconds);

// @ts-expect-error: and neither are the days, which is where they visibly differ
export const _kspDayPlusIrlDay = kspDay.plus(irlDay);

// Within one calendar, they combine as any other duration does.
export const _irlHoursPlusIrlMinutes = value("irl:h", 1).plus(
  value("irl:min", 30),
);

// ── A namespaced token is a different unit, at compile time too ─────────────
// An Uplink's `snacks:g` is outside the catalog, so `SameDimensionAs` collapses
// to `never` and `plus` accepts only an exact match. That is the safe reading
// when we know nothing about a third party's symbol, and here it happens to be
// exactly right: grams are not gees.
const grams = value("snacks:g", 500);
const gees = value("g", 2);

export const _gramsPlusGrams = grams.plus(value("snacks:g", 250));

// @ts-expect-error: a namespaced gram is not the first-party g-force
export const _gramsPlusGees = grams.plus(gees);

// ── Ordering is a method, because the operator cannot be ────────────────────
export const _ordered: boolean = hours.greaterThan(seconds);
export const _sortable: number = hours.compare(seconds);

// @ts-expect-error: ordering across dimensions is as wrong as adding across them
export const _orderedAcross = metres.lessThan(seconds);

// ── Sign, magnitude and selection ───────────────────────────────────────────
export const _draining: boolean = value("units/s", -0.3).isNegative();
export const _drift = metres.abs();
export const _ceiling = metres.max(value("km", 1));

// @ts-expect-error: selecting between different dimensions has no answer
export const _acrossDimensions = metres.max(seconds);

// ── UnknownUnit: shape guaranteed, contents blocked ─────────────────────────
// The wire named a unit this build has no static knowledge of (an Uplink's
// symbol off a payload, not a hand-typed literal). `Value<UnknownUnit>` reads
// like `Array<unknown>`: the SHAPE is guaranteed, so `.magnitude` and `.unit`
// need no narrowing, but the CONTENT is not, so nothing that combines two
// values is allowed through, not even a second `Value<UnknownUnit>`.

type Expect<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? "OK"
    : ["MISMATCH", A, B];

declare const unknownA: Value<UnknownUnit>;
declare const unknownB: Value<UnknownUnit>;

export const _unknownMagnitudeReadable: Expect<
  typeof unknownA.magnitude,
  number
> = "OK";
export const _unknownUnitReadable: Expect<typeof unknownA.unit, UnknownUnit> =
  "OK";

// @ts-expect-error: two unknowns are not known to match one another either,
// so plus does not even accept a second UnknownUnit value.
export const _unknownPlusUnknown = unknownA.plus(unknownB);

// @ts-expect-error: nor does it accept an exact match of a KNOWN unit, since
// UnknownUnit carries no symbol to check that match against.
export const _unknownPlusMetres = unknownA.plus(metres);

// A value with an unknown unit still satisfies a `Value`-shaped prop: the
// generic default (`U = string`) is what a rendering component like
// `<Unit value={v} />` actually accepts, and UnknownUnit is still a string.
function acceptsAnyValue(_v: Value): void {}
acceptsAnyValue(unknownA);

// ── A BARE operand, always in base units ────────────────────────────────────
// One rule: the number is in the dimension's base unit, never the receiver's.
// So these all compile, and `metres.lessThan(1000)` is a thousand METRES.

export const _eccLessThanBare = value("1", 0.7).lessThan(1);
export const _eccGreaterThanEqualBare = value("1", 1).greaterThanOrEqual(1);
export const _ratioGreaterThanBare = value("ratio", 0.5).greaterThan(0.25);
export const _metresLessThanBare = metres.lessThan(1000);
export const _secondsGreaterThanBare = seconds.greaterThan(90);
export const _percentLessThanBare = value("%", 50).lessThan(50);
export const _compareAgainstBare = metres.compare(1000);

// Arithmetic keeps the receiver's unit rather than shedding it to a number,
// which is what stops the overload reopening the unitless-arithmetic hatch.
const metresMinusBare = metres.minus(3);
const hoursPlusBare = hours.plus(60);
export const _metresMinusBareKeepsUnit: Expect<
  typeof metresMinusBare,
  Value<"m">
> = "OK";
export const _hoursPlusBareKeepsUnit: Expect<
  typeof hoursPlusBare,
  Value<"h">
> = "OK";

// A count is its own base dimension, so a bare number is admitted here too. The
// separate `_countPlusRatio` case above still rejects the RATIO, unchanged: the
// bare overload widens what a number may mean, not what a dimension may absorb.
export const _countPlusBare = value("count", 3).plus(1);

// ── A point takes no bare operand ───────────────────────────────────────────
// A bare number cannot say whether it means an instant or a duration, and
// telling those apart is the whole job of the affine rules.

// @ts-expect-error: an instant minus a bare number would have to guess.
export const _utMinusBare = value("ut", 100).minus(3);

// @ts-expect-error: nor can an instant be ordered against a bare number.
export const _utLessThanBare = value("ut", 100).lessThan(100);

// @ts-expect-error: and an instant still cannot be scaled, unchanged from before.
export const _utScaled = value("ut", 100).times(2);

// ── Validity needs no operand, like sign ────────────────────────────────────
export const _isFiniteTakesNothing: Expect<
  ReturnType<typeof metres.isFinite>,
  boolean
> = "OK";

// @ts-expect-error: validity is a property of the magnitude, not a comparison.
export const _isFiniteRejectsOperand = metres.isFinite(1);

// ── min/max take a bare operand, and NARROW when they do ────────────────────
// The `Value` arm returns the union (either operand can win, each keeping its own
// unit); the bare arm cannot, because a bare number has no unit to win with, so it
// resolves to `Value<U>` and the overload order is what expresses that.

const clamped = seconds.max(0);
export const _maxBareNarrowsToReceiverUnit: Expect<
  typeof clamped,
  Value<"s">
> = "OK";

const floored = metres.min(1000);
export const _minBareNarrowsToReceiverUnit: Expect<
  typeof floored,
  Value<"m">
> = "OK";

// The Value arm is unchanged: either side can be returned, so it stays a union.
export const _maxValueArmStillUnion = hours.max(seconds);

// @ts-expect-error: a point takes no bare operand here either, same as everywhere.
export const _utMaxBare = value("ut", 100).max(0);
