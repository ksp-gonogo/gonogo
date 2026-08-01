import type { UiKitTheme } from "./theme";

/**
 * `default-dark`: the built-in mission-control theme.
 *
 * Token values name what is *currently* in the codebase, so the migration
 * from raw hex constants to `theme.*` tokens is mechanical. Palette
 * rationalisation (consolidating near-duplicate greys, retiring unused
 * shades) is deliberately deferred to a later commit so a structural sweep
 * can be a pure refactor with no visual diff.
 *
 * Typography sizes are emitted as CSS-variable strings so the responsive
 * overrides in `tokens.css` (coarse-pointer bumps etc.) keep working when
 * consumers read from the theme instead of the raw variable.
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
    status: {
      go: {
        fg: "var(--color-status-go-fg)",
        bg: "var(--color-status-go-bg)",
      },
      nogo: {
        fg: "var(--color-status-nogo-fg)",
        bg: "var(--color-status-nogo-bg)",
      },
      warning: {
        fg: "var(--color-status-warning-fg)",
        bg: "var(--color-status-warning-bg)",
      },
      info: {
        fg: "var(--color-status-info-fg)",
        bg: "var(--color-status-info-bg)",
      },
    },
    focus: "var(--color-focus)",
  },
  typography: {
    family: {
      mono: 'ui-monospace, "JetBrains Mono", "IBM Plex Mono", Menlo, Consolas, monospace',
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
  // Handles onto the ladders in tokens.css, not values of their own. These
  // held raw px until the token migration, which made this object a second
  // home for the same numbers while `typography.size` right above already
  // pointed at `var()`. Every mapping below is exact, so nothing rendered
  // moves; the t-shirt names are kept because they are the published
  // `ThemeSpace` / `ThemeRadii` contract, and renaming them to match the
  // rung numbers would break consumers for no gain.
  space: {
    xs: "var(--space-2)",
    sm: "var(--space-4)",
    md: "var(--space-8)",
    lg: "var(--space-12)",
    xl: "var(--space-16)",
  },
  radii: {
    xs: "var(--radius-xs)",
    sm: "var(--radius-sm)",
    md: "var(--radius-md)",
    lg: "var(--radius-lg)",
    pill: "var(--radius-pill)",
  },
  borders: {
    subtle: "1px solid var(--color-border-subtle)",
    strong: "1px solid var(--color-border-strong)",
  },
};
