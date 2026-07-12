/**
 * Typed theme contract.
 *
 * Themes name the project's design tokens by role (`text.muted`, not
 * `gray.500`) so future palette tweaks change the value behind the role
 * instead of forcing a sweep across every consumer.
 *
 * Sizes and spacing are emitted as CSS-variable strings (e.g.
 * `var(--font-size-base)`) so the responsive overrides in `tokens.css`
 * (coarse-pointer bumps, `prefers-reduced-motion`, future
 * `prefers-color-scheme`) keep working when a styled-component switches from a
 * raw CSS var to `theme.typography...`.
 */

// Type-only import: required for the `declare module "styled-components"`
// augmentation below to resolve the module under TypeScript's module
// resolution. Without an actual reference, `declare module` reports the
// module as unfound even though it's installed.
import type {} from "styled-components";

export interface ThemeColors {
  text: {
    primary: string;
    muted: string;
    dim: string;
    /**
     * Lowest-contrast foreground tier — placeholder text, disabled labels,
     * extreme captions. Fails large-text WCAG contrast on dark surfaces;
     * use sparingly for non-essential content.
     */
    faint: string;
    inverse: string;
  };
  surface: {
    app: string;
    panel: string;
    raised: string;
    sunken: string;
  };
  border: {
    subtle: string;
    strong: string;
  };
  accent: {
    fg: string;
    bg: string;
  };
  status: {
    go: { fg: string; bg: string };
    nogo: { fg: string; bg: string };
    warning: { fg: string; bg: string };
    info: { fg: string; bg: string };
  };
  focus: string;
}

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

export interface ThemeSpace {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
}

export interface ThemeRadii {
  /** Tightest corner — buttons and small controls. */
  xs: string;
  sm: string;
  md: string;
  /** Fully rounded — chips, avatars, toggle knobs. */
  pill: string;
}

export interface ThemeBorders {
  subtle: string;
  strong: string;
}

export interface UiKitTheme {
  colors: ThemeColors;
  typography: ThemeTypography;
  space: ThemeSpace;
  radii: ThemeRadii;
  borders: ThemeBorders;
}

declare module "styled-components" {
  // styled-components reads `DefaultTheme` from its own module namespace.
  // Augmenting it here gives every `${({ theme }) => ... }` callback across
  // the workspace typed access to the theme. The augmentation lives in this
  // file (exported transitively from `@ksp-gonogo/ui-kit`'s index, and from
  // `@ksp-gonogo/core` which re-exports it) so consumer packages pick it up
  // automatically — TypeScript would not load a sibling `.d.ts` from a barrel
  // re-export.
  export interface DefaultTheme extends UiKitTheme {}
}
