/**
 * The project's render, for the packages inside this repo.
 *
 * It is no longer defined here. The themed `render`/`renderHook` live in
 * `@ksp-gonogo/sitrep-sdk/testing`; the rail-mounted overrides of them live in
 * `@ksp-gonogo/ui-kit/testing` as `renderWithRail`/`renderHookWithRail`
 * (`useCommand` registers every handle with the nearest command rail and a
 * dev build throws with none mounted), named apart from the sdk's own
 * `render`/`renderHook` because both packages are published and
 * `styleguide-shared-published-surface.test.ts` fails a name declared in
 * both. This module still calls them `render`/`renderHook`, the short import
 * path the app-side packages already use, kept so several hundred call sites
 * do not have to move to say the same thing.
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
export {
  renderHookWithRail as renderHook,
  renderWithRail as render,
} from "@ksp-gonogo/ui-kit/testing";
