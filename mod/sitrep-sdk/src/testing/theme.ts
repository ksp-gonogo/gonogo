import { GENERATED_TEST_THEME } from "../__generated__/test-theme";

// Generated from `@ksp-gonogo/theme`'s `defaultDarkTheme`, which the sdk cannot import; `sdk-testing-theme.conformance.test.ts` in core keeps the copy current.
/**
 * The theme `render` mounts: the app's default dark theme. Its colours
 * are CSS variable references, so a test asserts on
 * `color: var(--color-text-primary)` exactly as the app renders it.
 *
 * @category Rendering
 */
export const harnessTheme = GENERATED_TEST_THEME;
