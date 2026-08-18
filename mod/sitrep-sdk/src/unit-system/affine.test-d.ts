import { value } from "./value";

/**
 * The affine rules, at the type level.
 *
 * An instant and a duration share a dimension and are not the same thing. Before
 * this, `{s:1}` was one undifferentiated pool: `ut.minus(ut)` answered `Value<"ut">`
 * (the gap between two instants is an instant), `ut.plus(ut)` compiled, `ut` could be
 * multiplied by a scalar, and `value("ut", 100).greaterThan(value("s", 76))` was
 * quietly true.
 *
 * Half of these cases assert what is now REFUSED, which a type test can only do with
 * `@ts-expect-error`: the directive fails the build if the line it guards starts
 * compiling again. So the negative half is load-bearing in both directions, and a
 * rule that silently widened would break this file rather than pass it.
 *
 * The other half is the regression net. `energy`/`torque` and `percent`/`ratio` are
 * the two other dimensions carrying more than one kind, and NEITHER is affine: the
 * first is a coincidence, the second is one quantity at two scales. Both keep working
 * exactly as before, and they are asserted here rather than trusted, because the
 * mechanism reads a declaration and a widened declaration would reach them first.
 */

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

const ut = value("ut", 1_000);
const laterUt = value("ut", 1_200);
const seconds = value("s", 60);
const hours = value("h", 2);

// ── point - point = vector ──────────────────────────────────────────────────
// The rule the whole thing exists for. Lands on the BASE vector unit, not on a
// union of every duration spelling.
const gap = laterUt.minus(ut);
export type _GapIsSeconds = Expect<Equal<typeof gap, typeof seconds>>;

// ── point + vector = point ─────────────────────────────────────────────────
const shifted = ut.plus(seconds);
export type _ShiftedIsUt = Expect<Equal<typeof shifted, typeof ut>>;
// Any rung of the vector family, not just the base one.
const shiftedByHours = ut.plus(hours);
export type _ShiftedByHoursIsUt = Expect<
  Equal<typeof shiftedByHours, typeof ut>
>;

// ── point - vector = point ─────────────────────────────────────────────────
const earlier = ut.minus(seconds);
export type _EarlierIsUt = Expect<Equal<typeof earlier, typeof ut>>;

// ── vector +- vector = vector ──────────────────────────────────────────────
const longer = seconds.plus(hours);
export type _LongerIsSeconds = Expect<Equal<typeof longer, typeof seconds>>;

// ── point + point is ILLEGAL ───────────────────────────────────────────────
// @ts-expect-error two instants do not add: there is no such thing as twice-the-epoch
ut.plus(laterUt);

// ── point * scalar is ILLEGAL ──────────────────────────────────────────────
//
// These three nearly passed for the wrong reason. `times`/`dividedBy`/`per` each
// carry a WIDE final overload taking `Value | number`, which accepted a scalar for a
// point even with the narrow arm typed `never`. The narrow arm alone looked correct
// and refused nothing; the wide arm had to be narrowed too. Caught because
// `@ts-expect-error` fails the build when the line it guards compiles, and only when
// run by the `typecheck` script: a bare `tsc -p tsconfig.json` does not include
// `test-d` files and reported clean throughout.
// @ts-expect-error scaling an instant is meaningless
ut.times(2);
// @ts-expect-error and so is dividing one
ut.dividedBy(2);
// @ts-expect-error `per` is `dividedBy` spelled for reading, and refuses the same
ut.per(2);

// ── ordering across point and vector is ILLEGAL ────────────────────────────
// @ts-expect-error "is this instant before that duration" has no answer
ut.greaterThan(seconds);
// @ts-expect-error and the same from the vector side
seconds.lessThan(ut);

// Ordering WITHIN a camp is untouched.
export const _utOrdersAgainstUt: boolean = ut.lessThan(laterUt);
export const _secondsOrderAgainstHours: boolean = seconds.lessThan(hours);

// ── the two non-affine multi-kind dimensions are UNCHANGED ─────────────────
//
// `energy` and `torque` coincide on {kg:1,m:2,s:-2}. That `J.plus(N·m)` compiles is
// a real defect, and it is NOT this mechanism's to fix: it is on the ledger as its
// own item. Asserted here so that if the affine rules ever widen to cover
// coincidental pairs, it is a deliberate change that breaks this line rather than a
// silent one.
export const _energyStillTakesTorque = value("J", 1).plus(value("N·m", 1));

// `percent` and `ratio` are the SAME quantity at two scales, and arithmetic between
// them is not merely legal but already relied on by `.in("%")`. If the mechanism
// ever treated a multi-kind dimension as affine by default, this is what would break
// first, and it would break something real.
export const _percentTakesRatio = value("%", 50).plus(value("ratio", 0.25));
export const _ratioTakesPercent = value("ratio", 0.25).plus(value("%", 50));
export const _percentOrdersAgainstRatio: boolean = value("%", 50).greaterThan(
  value("ratio", 0.25),
);

// Scaling a non-point is untouched, which is the common case by a long way.
export const _secondsScale = seconds.times(3);
export const _percentScales = value("%", 50).times(2);
