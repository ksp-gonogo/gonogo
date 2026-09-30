import type { UiKitTheme } from "./theme";

/**
 * `default-dark`: the built-in mission-control theme, and the one the app
 * mounts. Every colour and size is a CSS variable string (such as
 * `var(--color-text-primary)`), so responsive overrides such as larger type on
 * a touch screen still apply when a component reads the theme.
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
    weight: {
      regular: 400,
      bold: 700,
    },
    letterSpacing: {
      tight: "0.05em",
      label: "0.1em",
      wide: "0.15em",
      body: "0",
    },
  },
  borders: {
    subtle: "1px solid var(--color-border-subtle)",
    strong: "1px solid var(--color-border-strong)",
  },
};
