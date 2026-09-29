/**
 * The project's render, for the packages inside this repo.
 *
 * It is no longer defined here. The themed `render`/`renderHook` live in
 * `@ksp-gonogo/sitrep-sdk/testing`, and the rail-mounted overrides of them live
 * in `@ksp-gonogo/ui-kit/testing` (`useCommand` registers every handle with the
 * nearest command rail and a dev build throws with none mounted), both where a
 * third-party Uplink author can install them. This module is the short import
 * path the app-side packages already use, kept so several hundred call sites do
 * not have to move to say the same thing.
 *
 * **New code should import `@ksp-gonogo/sitrep-sdk/testing` and
 * `@ksp-gonogo/ui-kit/testing` directly.** An Uplink client MUST: this package
 * is `private: true`, and `packages/core/src/uplink-isolation.test.ts` fails on
 * it.
 *
 * `visibleText` and the unit matchers are in `@ksp-gonogo/ui-kit/testing` (no
 * React, no DOM), a separate entry so a runtime bundle never pulls React test code
 * in.
 */

export * from "@ksp-gonogo/sitrep-sdk/testing";
export { render, renderHook } from "@ksp-gonogo/ui-kit/testing";
