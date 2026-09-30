/*
 * Tokens are named by role so a palette change edits the value behind the role
 * instead of forcing a sweep across every consumer. Values are CSS variable
 * strings so the responsive overrides in tokens.css (coarse-pointer bumps,
 * prefers-reduced-motion) keep working when a component reads the theme rather
 * than the raw variable.
 *
 * This file is the contract only. The styled-components DefaultTheme
 * augmentation lives in ui-kit's src/styledComponentsTheme.ts, because an
 * augmentation only applies where it is compiled from source.
 */

/**
 * The colour half of a {@link UiKitTheme}. Tokens are named by role
 * (`text.muted`, `surface.raised`), not by hue, and each value is a CSS colour,
 * in the default theme a CSS variable string such as
 * `var(--color-text-muted)`.
 *
 * @category Theme
 */
export interface ThemeColors {
  /** Foreground text, from `primary` (strongest) down to `faint`. */
  text: {
    primary: string;
    muted: string;
    dim: string;
    /**
     * Lowest-contrast foreground tier: placeholder text, disabled labels,
     * extreme captions. Fails large-text WCAG contrast on dark surfaces;
     * use sparingly for non-essential content.
     */
    faint: string;
    /** Text on an accent or light fill. */
    inverse: string;
  };
  /** Backgrounds: `app` behind everything, `panel` for a widget, `raised` and `sunken` for areas within one. */
  surface: {
    app: string;
    panel: string;
    raised: string;
    sunken: string;
  };
  /** Border colours. */
  border: {
    subtle: string;
    strong: string;
  };
  /** The accent colour, as a foreground and as a background. */
  accent: {
    fg: string;
    bg: string;
  };
  /** The focus ring colour. */
  focus: string;
}

/**
 * The type half of a {@link UiKitTheme}: the font family, a size scale, weights
 * and letter spacings. Sizes are CSS variable strings such as
 * `var(--font-size-base)`; weights are numbers.
 *
 * @category Theme
 */
export interface ThemeTypography {
  family: {
    mono: string;
  };
  size: {
    xs: string;
    sm: string;
    base: string;
    lg: string;
  };
  weight: {
    regular: number;
    bold: number;
  };
  letterSpacing: {
    /** Subtle negative-to-zero tracking for dense running text. */
    tight: string;
    /** Wide tracking for uppercase labels and section headers. */
    label: string;
    /** Widest tracking for spaced-out captions and status chips. */
    wide: string;
    /** Neutral (no) tracking for body copy. */
    body: string;
  };
}

/**
 * Whole CSS `border` shorthands for a {@link UiKitTheme}, such as
 * `1px solid var(--color-border-subtle)`.
 *
 * @category Theme
 */
export interface ThemeBorders {
  subtle: string;
  strong: string;
}

/**
 * What a theme supplies: colour, type and borders. This is the object a theme
 * hands to styled-components' `ThemeProvider`, and what `theme` holds inside a
 * styled-components template.
 *
 * Spacing and corner radii are not part of a theme. They are CSS variables the
 * kit's layout primitives read directly, so a theme that wants different
 * geometry ships a stylesheet redefining those variables.
 *
 * @category Theme
 */
export interface UiKitTheme {
  colors: ThemeColors;
  typography: ThemeTypography;
  borders: ThemeBorders;
}
