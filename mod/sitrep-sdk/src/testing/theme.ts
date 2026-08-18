/**
 * The theme the test harness renders with: a byte-for-byte PORT of
 * `@ksp-gonogo/theme`'s `defaultDarkTheme`, not a re-export and not derived.
 *
 * The sdk is the leaf every other package depends on, so it cannot name
 * `@ksp-gonogo/theme` (private, unpublished) or `@ksp-gonogo/ui-kit` (which
 * imports this package in 19 files, so the edge would be a cycle). Same
 * constraint, and the same answer, as `../api/localStorageStore.ts` and
 * `safeRandomUuid`: copy the leaf values, and guard the copy.
 *
 * It is NOT derived from the property path, which was the first design and does
 * not work: 18 of these 45 leaves do not follow the path. `space.md` is
 * `--space-8`, `typography.size.xs` is `--font-size-xs` rather than
 * `--typography-size-xs`, `typography.weight.regular` is the number 400, and
 * `borders.subtle` is a composite. The t-shirt-name-to-rung-number mapping in
 * `space` is arbitrary by design (see the real theme's own comment: the names are
 * the published `ThemeSpace` contract and are deliberately not renamed to match
 * the rungs), so no rule recovers it.
 *
 * Kept honest by `packages/core/src/sdk-testing-theme.conformance.test.ts`, which
 * walks the REAL theme and compares every leaf, so drift fails on the theme's own
 * contents rather than on anyone remembering this file exists. Core is the one
 * package that can see both.
 *
 * The values are all `var(--…)` handles or literals; the numbers behind them live
 * in `tokens.css`, which no test loads. So a test asserts on
 * `padding: var(--space-8)`, exactly as it does in the app.
 */
export const harnessTheme = {
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
} as const;
