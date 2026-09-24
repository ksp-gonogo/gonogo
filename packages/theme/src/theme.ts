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
 *
 * This file is the contract only, plain interfaces, no `styled-components`
 * augmentation. The `declare module "styled-components"` block that binds
 * `UiKitTheme` onto `DefaultTheme` lives in the package that needs it
 * (`@ksp-gonogo/ui-kit`, `src/styledComponentsTheme.ts`), because an
 * augmentation only applies where it is compiled from source; see that file
 * for why shipping one through a built `.d.ts` does not work.
 */

export interface ThemeColors {
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

export interface ThemeBorders {
  subtle: string;
  strong: string;
}

/**
 * What a theme supplies: colour, type and borders.
 *
 * Spacing and corner radii are not here. They are handles onto the ladders in
 * `tokens.css` rather than choices a theme makes, so the kit's layout
 * primitives carry their own and a theme that wants different geometry ships a
 * sheet redefining the rungs. A theme author therefore never has to name a
 * scale type to write one.
 */
export interface UiKitTheme {
  colors: ThemeColors;
  typography: ThemeTypography;
  borders: ThemeBorders;
}
