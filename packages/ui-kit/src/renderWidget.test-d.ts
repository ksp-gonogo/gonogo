/**
 * An Uplink can name what `renderWidget` returns.
 *
 * The type is `RenderResult`, and it is published from
 * `@ksp-gonogo/sitrep-sdk/testing` rather than from this kit's testing entry,
 * which does not re-export the sdk's. So the proof is that the name an author
 * imports from there is exactly the return type here: if either entry stops
 * carrying it, or the two drift apart, the package `typecheck` fails.
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
