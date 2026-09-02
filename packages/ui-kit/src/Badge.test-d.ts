// Type-level proof that `Badge` has no `tone` prop and speaks only `Severity`.
//
// `tone` was a fold alias onto `severity`, marked `@deprecated` with a note
// saying a styleguide ratchet would remove it once the migration window
// closed. No such ratchet was ever written, and there was no window to honour:
// ui-kit had not shipped a release carrying the alias. It was deleted outright
// rather than left to rot into a trap for the first outside author.
//
// This file is what the deprecation note promised. `tone` cannot come back
// silently: re-adding it to `BadgeProps` (or reaching it through the inherited
// `HTMLAttributes`) fails the package `typecheck`, which runs this via
// `tsconfig.test-d.json`.

import type { BadgeProps } from "./Badge";
import type { Severity } from "./status/severity";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

/** No `tone` key at all, deprecated or otherwise. */
type _NoToneProp = Expect<
  Equal<"tone" extends keyof BadgeProps ? true : false, false>
>;

/**
 * `severity` is the canonical scale and nothing wider. A future alias smuggled
 * in by widening this union (`Severity | BadgeTone`) fails here too, which is
 * the reintroduction path a `keyof` check alone would miss.
 */
type _SeverityIsCanonical = Expect<
  Equal<NonNullable<BadgeProps["severity"]>, Severity>
>;
