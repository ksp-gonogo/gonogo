/**
 * An Uplink can name what `renderWidget` returns: the `RenderResult` published
 * from `@ksp-gonogo/sitrep-sdk/testing` is exactly its return type.
 */

import type { RenderResult } from "@ksp-gonogo/sitrep-sdk/testing";
import type { renderWidget } from "./testing";

type Equal<Left, Right> =
  (<Probe>() => Probe extends Left ? 1 : 2) extends <
    Probe,
  >() => Probe extends Right ? 1 : 2
    ? true
    : false;
type Expect<Condition extends true> = Condition;

type _NameableFromTheSdk = Expect<
  Equal<ReturnType<typeof renderWidget>, RenderResult>
>;
