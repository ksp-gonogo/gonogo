// Type-level proof that `Badge` has no `tone` prop and speaks only `Severity`, run by the package `typecheck`.

import type { BadgeProps } from "./Badge";
import type { Severity } from "./status/severity";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

/** No `tone` key at all. */
type _NoToneProp = Expect<
  Equal<"tone" extends keyof BadgeProps ? true : false, false>
>;

/** `severity` is exactly `Severity`, so an alias cannot return by widening the union either. */
type _SeverityIsCanonical = Expect<
  Equal<NonNullable<BadgeProps["severity"]>, Severity>
>;
