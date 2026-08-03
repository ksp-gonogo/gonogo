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

import { value } from "./value";

const watts = value("W", 5);
const joulesPerSecond = value("J/s", 3);
const newtonMetres = value("N·m", 5);
const joules = value("J", 3);
const metres = value("m", 5);
const seconds = value("s", 35);
const hours = value("h", 2);

// ── Same dimension, different name: allowed ─────────────────────────────────
export const _wattsPlusJoulesPerSecond = watts.plus(joulesPerSecond);

// ── Same dimension, different KIND: allowed, and deliberately so ────────────
// Kind gating cannot name the kind of `force.times(distance)`, so kind is
// display-only and `format="N·m"` is how a torque keeps reading as a torque.
export const _torquePlusEnergy = newtonMetres.plus(joules);

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
