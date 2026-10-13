import type { UiKitTheme } from "./theme";

/**
 * `default-dark`: the built-in mission-control theme, and the one the app
 * mounts. Every value is the CSS variable it names (`text.primary` is
 * `var(--color-text-primary)`), so mounting it changes nothing: the values come
 * from `@ksp-gonogo/ui-kit/tokens.css`, which has to be imported once for any
 * of them to have a value.
 *
 * @category Theme
 */
export const defaultDarkTheme: UiKitTheme = {
  colors: {
    text: {
      primary: "var(--color-text-primary)",
      muted: "var(--color-text-muted)",
      dim: "var(--color-text-dim)",
      faint: "var(--color-text-faint)",
      inverse: "var(--color-text-inverse)",
    },
    surface: {
      app: "var(--color-surface-app)",
      panel: "var(--color-surface-panel)",
      raised: "var(--color-surface-raised)",
      sunken: "var(--color-surface-sunken)",
    },
    border: {
      subtle: "var(--color-border-subtle)",
      strong: "var(--color-border-strong)",
    },
    accent: {
      fg: "var(--color-accent-fg)",
      bg: "var(--color-accent-bg)",
    },
    focus: "var(--color-focus)",
  },
  typography: {
    family: {
      mono: "var(--font-family-mono)",
    },
    size: {
      xs: "var(--font-size-xs)",
      sm: "var(--font-size-sm)",
      base: "var(--font-size-base)",
      lg: "var(--font-size-lg)",
    },
  },
};
