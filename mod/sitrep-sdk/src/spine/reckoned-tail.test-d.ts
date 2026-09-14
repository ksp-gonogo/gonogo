import type { Value } from "../unit-system/value";
import type { ReckonedSample } from "./timeline-store";

/**
 * That a reckoned tail's band ends are in the value's own unit, asserted rather
 * than promised in prose.
 *
 * The promise is what stood here before: `UncertaintyBand`'s doc comment said
 * its `value` is the same quantity `reckon` produced, and the tail's two ends
 * were bare magnitudes trusting it. Nothing could check that, and nothing had
 * to until the point estimate started carrying a unit of its own, at which
 * point a band in the wrong unit became a number a chart shades against an axis
 * it does not belong on.
 *
 * Runs only under `pnpm typecheck`, the sole pass that compiles `*.test-d.ts`
 * (vitest goes through esbuild and never typechecks). Every `@ts-expect-error`
 * here is two-sided: it fails if the line starts compiling, because the
 * directive is then unused.
 */

declare const metres: Value<"m">;
declare const seconds: Value<"s">;

/*
 * The whole point, stated positively first: a band in the value's unit is the
 * ordinary case and must stay ordinary. Without this, a rule that rejected
 * every end would read as the guarantee holding.
 */
const banded: ReckonedSample<Value<"m">> = {
  atUt: 0,
  value: metres,
  basis: "rate-integration",
  bandLo: metres,
  bandHi: metres,
  bandKind: "bound",
};

const crossUnit: ReckonedSample<Value<"m">> = {
  atUt: 0,
  value: metres,
  basis: "rate-integration",
  // @ts-expect-error seconds are not a bound on a value in metres.
  bandLo: seconds,
  bandHi: metres,
  bandKind: "bound",
};

const bareEnd: ReckonedSample<Value<"m">> = {
  atUt: 0,
  value: metres,
  basis: "rate-integration",
  // @ts-expect-error a magnitude that has forgotten its unit is not a bound.
  bandLo: 90,
  bandHi: metres,
  bandKind: "bound",
};

/*
 * A bare-magnitude payload still takes a WRAPPED end: a band is only ever minted
 * from an `UncertaintyBand`, whose ends are quantities whatever the payload
 * holds. There is no unit on the value for the end to agree with, so any unit is
 * accepted and a bare number is still not.
 */
const bareValue: ReckonedSample<number> = {
  atUt: 0,
  value: 7,
  basis: "rate-integration",
  bandLo: seconds,
  bandHi: metres,
  bandKind: "sigma1",
};

const bareValueBareEnd: ReckonedSample<number> = {
  atUt: 0,
  value: 7,
  basis: "rate-integration",
  // @ts-expect-error the value being bare does not make its band bare too.
  bandLo: 6,
  bandHi: metres,
  bandKind: "sigma1",
};

// Read once so nothing above is an unused binding.
export const declared = [
  banded,
  crossUnit,
  bareEnd,
  bareValue,
  bareValueBareEnd,
].length;
