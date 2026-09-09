// The compile-time half of the guard. `guards.test.ts` proves the runtime
// check is real; this proves it is the ONLY route from an unknown unit to
// arithmetic, which no runtime assertion can reach.

import { isUnit, unitGuard } from "./guards";
import type { UnknownUnit, Value } from "./value";

declare const a: Value<UnknownUnit>;
declare const b: Value<UnknownUnit>;

// Shape is guaranteed with no narrowing at all: this is `Array<unknown>`, not
// bare `unknown`. Listing resources is the common case by a wide margin and
// must stay ceremony-free.
export const magnitude: number = a.magnitude;
export const symbol: string = a.unit;

// @ts-expect-error two unknown units are not known to match, so nothing doing
export const unguarded = a.plus(b);

const isOxygen = unitGuard("Oxygen:u");

export function bothProven() {
  // Each operand needs its own proof.
  if (isOxygen(a) && isOxygen(b)) {
    return a.plus(b);
  }
  return undefined;
}

export function onlyOneProven() {
  if (isOxygen(a)) {
    // @ts-expect-error b is still unknown; proving one side is not enough
    return a.plus(b);
  }
  return undefined;
}

// A guard for a different resource does not launder one into the other.
const isFood = unitGuard("Food:u");

export function differentResources() {
  if (isOxygen(a) && isFood(b)) {
    // @ts-expect-error oxygen and food are different units, proven or not
    return a.plus(b);
  }
  return undefined;
}

// ── isUnit: the same proof, for a unit that arrives as a parameter ──────────
// `unitGuard` cannot be asked this. It takes `const S extends string` and
// returns a predicate, so the symbol has to be written down at the call site;
// here it is whatever the caller passed.

export function narrowsToTheParameter<U extends string>(
  v: Value<UnknownUnit>,
  unit: U,
): Value<U> | undefined {
  return isUnit(v, unit) ? v : undefined;
}

export function refusesTheUnnarrowed<U extends string>(
  v: Value<UnknownUnit>,
  _unit: U,
): Value<U> | undefined {
  // @ts-expect-error an unknown unit is not a `U` until the guard says so
  return v;
}

// Each value needs its own proof, as with `unitGuard`: narrowing one and
// returning another is still refused.
export function oneProofIsNotTwo<U extends string>(
  v: Value<UnknownUnit>,
  w: Value<UnknownUnit>,
  unit: U,
): Value<U> | undefined {
  if (isUnit(v, unit)) {
    // @ts-expect-error w was never asked about
    return w;
  }
  return undefined;
}
