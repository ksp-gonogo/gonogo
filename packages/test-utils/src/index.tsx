/**
 * The project's render, for the packages inside this repo.
 *
 * It is no longer defined here. `render`/`renderHook` supply the theme every
 * kit primitive needs, which is a fact about `@ksp-gonogo/ui-kit`, so they now
 * live in that package as `@ksp-gonogo/ui-kit/testing-react` where a
 * third-party Uplink author can actually install them. This module is the short
 * import path the app-side packages already use, kept so several hundred call
 * sites do not have to move to say the same thing.
 *
 * **New code should import `@ksp-gonogo/ui-kit/testing-react` directly.** An
 * Uplink client MUST: this package is `private: true`, and
 * `packages/core/src/uplink-isolation.test.ts` fails on it.
 *
 * `visibleText` and the unit matchers are in `@ksp-gonogo/ui-kit/testing` (no
 * React, no DOM), a separate entry so a runtime bundle never pulls React test
 * code in.
 */
export * from "@ksp-gonogo/ui-kit/testing-react";
