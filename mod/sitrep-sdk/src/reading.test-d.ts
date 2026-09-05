import type { Reading, UnmodelledReading } from "./reading";
import type { Value } from "./unit-system/value";

/**
 * The compiler pressure `Reading` exists to apply, asserted rather than
 * believed.
 *
 * `reckonability` moved off `state` and onto its own `reckoning` discriminant so
 * that live-and-reckonable became representable. The obvious way to do that is
 * an OPTIONAL `reckoned` field, and it is the wrong way: an optional field
 * compiles everywhere and answers `undefined`, so a destructuring consumer
 * ignores a reckoning that EXISTS by default and the widget still looks right.
 * That is the exact failure the type is built to prevent, and nothing in a
 * migration of ninety call sites would have noticed the guarantee quietly
 * turning into that.
 *
 * This file runs only under `pnpm typecheck`, the sole pass that compiles
 * `*.test-d.ts` (vitest goes through esbuild and never typechecks).
 *
 * ## Every assertion here is two-sided
 *
 * Each `@ts-expect-error` fails BOTH ways round: it fails if the line starts
 * compiling, because the directive is then unused, and it fails if the line
 * errors for some unrelated reason a reader would misread as the guarantee
 * holding. A one-sided check on absence reports success when it has gone blind,
 * which is how a guarantee gets deleted under a passing suite.
 */

declare const reading: Reading<number>;

/*
 * The guarantee. Reaching a reckoning costs a written test, exactly as reaching
 * a value costs one: on a reading nobody has narrowed, `reckoned` is not merely
 * absent at runtime, it is absent from the type.
 */
// @ts-expect-error `reckoned` is unreachable until `reckoning` is narrowed.
export const unnarrowed = reading.reckoned;

/*
 * And narrowing the OTHER axis does not open it. This is the half that would
 * have been lost by folding the reckoning back into `state`, and the half a
 * migration is most likely to break by accident: a widget that has established
 * a value is not thereby entitled to a model.
 */
export function narrowingStateAloneIsNotEnough(r: Reading<number>) {
  if (r.state === "stale") {
    // @ts-expect-error a value-bearing state does not imply a model.
    return r.reckoned;
  }
  if (r.state === "observed") {
    // @ts-expect-error the same on the live side, which is the new capability.
    return r.reckoned;
  }
  return undefined;
}

/*
 * The axes narrow independently and in either order, which is what makes them
 * orthogonal rather than nested. Both of these compile, and a shape that
 * reintroduced the nesting would break one of them.
 */
export function reckoningNarrowsWithoutState(
  r: Reading<number>,
): number | null {
  return r.reckoning === "available" ? r.reckoned.value : null;
}

export function reckoningSurvivesLive(r: Reading<number>): Value<"ut"> | null {
  /*
   * A live reading carrying a model: unrepresentable before the axes split, and
   * the whole point of splitting them. `atUt` proves the narrowing landed on the
   * observed member rather than collapsing to `never`.
   */
  if (r.state === "observed" && r.reckoning === "available") return r.atUt;
  return null;
}

export function staleWithoutAModelStillHasItsValue(r: Reading<number>): number {
  if (r.state === "stale" && r.reckoning === "none") return r.value;
  return 0;
}

/*
 * `UnmodelledReading` is the type a topic in `NEVER_RECKONABLE` reads as, and
 * the return of `withoutReckoning`. It keeps every state, so the judgement
 * `stale` demands is undiminished, and it can never carry a model.
 */
declare const unmodelled: UnmodelledReading<number>;

// @ts-expect-error an unmodelled reading has no `reckoned` in any state.
export const noModelOnUnmodelled = unmodelled.reckoned;

export const unmodelledKeepsItsStates:
  | "pending"
  | "unowned"
  | "absent"
  | "observed"
  | "stale" = unmodelled.state;

/*
 * A `Reading` is assignable FROM an unmodelled one and not the other way, which
 * is what makes declining to propagate a narrowing rather than a cast.
 */
export const wideningIsFine: Reading<number> = unmodelled;

// @ts-expect-error narrowing back has to be a written decision, not an assignment.
export const narrowingIsNot: UnmodelledReading<number> = reading;
