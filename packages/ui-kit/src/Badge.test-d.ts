// Type-level proof that `Badge` has no `severity` prop and speaks only `Tone`, run by the package `typecheck`.

import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import type { BadgeProps } from "./Badge";

type Equal<Left, Right> =
  (<Probe>() => Probe extends Left ? 1 : 2) extends <
    Probe,
  >() => Probe extends Right ? 1 : 2
    ? true
    : false;
type Expect<Condition extends true> = Condition;

/** No `severity` key at all. */
type _NoSeverityProp = Expect<
  Equal<"severity" extends keyof BadgeProps ? true : false, false>
>;

/** `tone` is exactly `Tone`, so a second vocabulary cannot return by widening the union either. */
type _ToneIsCanonical = Expect<Equal<NonNullable<BadgeProps["tone"]>, Tone>>;
