/**
 * The project's render, for the packages inside this repo.
 *
 * It is no longer defined here. `render`/`renderHook` mount the kit's theme, which
 * every ui-kit primitive reads straight off the styled-components context, and they
 * now live in `@ksp-gonogo/sitrep-sdk/testing` where a third-party Uplink author
 * can install them. This module is the short import path the app-side packages
 * already use, kept so several hundred call sites do not have to move to say the
 * same thing.
 *
 * **New code should import `@ksp-gonogo/sitrep-sdk/testing` directly.** An Uplink
 * client MUST: this package is `private: true`, and
 * `packages/core/src/uplink-isolation.test.ts` fails on it.
 *
 * `visibleText` and the unit matchers are in `@ksp-gonogo/ui-kit/testing` (no
 * React, no DOM), a separate entry so a runtime bundle never pulls React test code
 * in.
 */
export * from "@ksp-gonogo/sitrep-sdk/testing";
