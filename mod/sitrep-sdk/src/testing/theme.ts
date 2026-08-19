/**
 * The theme the test harness renders with.
 *
 * The values are GENERATED from `@ksp-gonogo/theme`'s `defaultDarkTheme` by
 * `scripts/gen-test-theme.mjs`, and kept current by
 * `packages/core/src/sdk-testing-theme.conformance.test.ts`, which walks the real
 * theme in both directions. Core is the only package that can see both ends.
 *
 * The copy exists because the sdk is the leaf every other package depends on: it
 * can name neither `@ksp-gonogo/theme` (private) nor `@ksp-gonogo/ui-kit` (which
 * imports the sdk, so the edge would cycle). See the generator's header for why an
 * accessor, a lazy `import()`, and a path-derived Proxy all fail.
 */
export { GENERATED_TEST_THEME as harnessTheme } from "../__generated__/test-theme";
