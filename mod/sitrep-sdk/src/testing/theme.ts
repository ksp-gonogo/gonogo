import { GENERATED_TEST_THEME } from "../__generated__/test-theme";

// Generated from `@ksp-gonogo/theme`'s `defaultDarkTheme`, which the sdk cannot import; `sdk-testing-theme.conformance.test.ts` in core keeps the copy current.
const { colors, typography } = GENERATED_TEST_THEME;

/**
 * The theme `render` mounted before the theme gained its spacing, shadow,
 * border, weight and motion groups: the colour roles and the font family and
 * sizes of the app's default dark theme, as CSS variable references. Useful for
 * testing that a component draws in the colours and type the operator sees.
 * {@link harnessThemeFull} holds every group.
 *
 * @category Rendering
 */
export const harnessTheme = {
  colors: {
    text: colors.text,
    surface: colors.surface,
    border: colors.border,
    accent: colors.accent,
    focus: colors.focus,
  },
  typography: {
    family: typography.family,
    size: {
      xs: typography.size.xs,
      sm: typography.size.sm,
      base: typography.size.base,
      lg: typography.size.lg,
    },
  },
} as const;

/**
 * The theme `render` mounts: the app's default dark theme in full, as CSS
 * variable references so a test asserts on `color: var(--color-text-primary)`
 * exactly as the app draws it. It holds `colors` (the text, surface, border and
 * accent roles, the focus ring, the status palette, the tag, marker and data
 * colours), `typography`, `radius`, `space`, `sizes`, `density`, `floating`,
 * `borderWidth` and `motion`. Useful for testing a component that reads any
 * group of the theme.
 *
 * @category Rendering
 */
export const harnessThemeFull = GENERATED_TEST_THEME;
