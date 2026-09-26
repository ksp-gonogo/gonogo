/**
 * An Uplink can name what `renderWidget` returns: the `RenderResult` published
 * from `@ksp-gonogo/sitrep-sdk/testing` is exactly its return type.
 */

import type { RenderResult } from "@ksp-gonogo/sitrep-sdk/testing";
import type { renderWidget } from "./testing";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

type _NameableFromTheSdk = Expect<
  Equal<ReturnType<typeof renderWidget>, RenderResult>
>;
