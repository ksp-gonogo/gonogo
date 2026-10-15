/*
 * The theme contract: what a theme supplies, and what `ThemeDefinition.theme`
 * holds. Tokens are named by role so a palette change edits the value behind
 * the role instead of forcing a sweep across every consumer. Each token names
 * the CSS variable of `@ksp-gonogo/ui-kit/tokens.css` that it sets: a theme
 * provider writes the values onto those variables, and the kit draws from the
 * variables, never from the theme object.
 *
 * The styled-components DefaultTheme augmentation lives in ui-kit's
 * src/styledComponentsTheme.ts, because an augmentation only applies where it
 * is compiled from source.
 */

/**
 * The colour half of a `UiKitTheme`. Tokens are named by role
 * (`text.muted`, `surface.raised`), not by hue, and each value is a CSS colour
 * that becomes the matching `--color-*` variable (`text.muted` sets
 * `--color-text-muted`). Useful for colouring text, surfaces and borders by
 * role, so every widget under a `UiKitThemeProvider` takes the theme's colours.
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
 * The type half of a `UiKitTheme`: the font family and a size scale. Each
 * value is a CSS value that becomes the matching `--font-family-*` or
 * `--font-size-*` variable. Useful for setting type in every widget from one
 * scale.
 *
 * @category Theme
 */
export interface ThemeTypography {
  /** The font families, as CSS `font-family` values. */
  family: {
    /** The monospace family every widget is set in. */
    mono: string;
  };
  /** The size scale, smallest first, each a CSS length. */
  size: {
    /** The smallest step of the scale. */
    xs: string;
    /** One step below body text. */
    sm: string;
    /** Body text. */
    base: string;
    /** One step above body text. */
    lg: string;
  };
}

/**
 * What a theme supplies: colour and type. A theme provider writes each value
 * onto its CSS variable, and the same object is what `theme` holds inside a
 * styled-components template.
 *
 * Spacing and corner radii are not part of a theme. They are CSS variables the
 * kit's layout primitives read directly, so a theme that wants different
 * geometry ships a stylesheet redefining those variables.
 * Useful for giving an Uplink's widgets the same look as the rest of the
 * dashboard, and for supplying a new theme.
 *
 * @category Theme
 */
export interface UiKitTheme {
  /** Every colour the kit draws with. */
  colors: ThemeColors;
  /** The font family and sizes. */
  typography: ThemeTypography;
}
