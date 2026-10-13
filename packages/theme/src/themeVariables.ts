import type { UiKitTheme } from "./theme";

/**
 * The CSS variable each theme token sets, as `[variable, read]` pairs. A theme
 * names roles; the kit draws from these variables.
 */
const TOKEN_VARIABLES: ReadonlyArray<
  readonly [variable: string, read: (theme: UiKitTheme) => string]
> = [
  ["--color-text-primary", (t) => t.colors.text.primary],
  ["--color-text-muted", (t) => t.colors.text.muted],
  ["--color-text-dim", (t) => t.colors.text.dim],
  ["--color-text-faint", (t) => t.colors.text.faint],
  ["--color-text-inverse", (t) => t.colors.text.inverse],
  ["--color-surface-app", (t) => t.colors.surface.app],
  ["--color-surface-panel", (t) => t.colors.surface.panel],
  ["--color-surface-raised", (t) => t.colors.surface.raised],
  ["--color-surface-sunken", (t) => t.colors.surface.sunken],
  ["--color-border-subtle", (t) => t.colors.border.subtle],
  ["--color-border-strong", (t) => t.colors.border.strong],
  ["--color-accent-fg", (t) => t.colors.accent.fg],
  ["--color-accent-bg", (t) => t.colors.accent.bg],
  ["--color-focus", (t) => t.colors.focus],
  ["--font-family-mono", (t) => t.typography.family.mono],
  ["--font-size-xs", (t) => t.typography.size.xs],
  ["--font-size-sm", (t) => t.typography.size.sm],
  ["--font-size-base", (t) => t.typography.size.base],
  ["--font-size-lg", (t) => t.typography.size.lg],
];

/**
 * The CSS variables a theme sets, by name. A value that is the variable it
 * would set (`var(--color-text-primary)` for `--color-text-primary`) is left
 * out: writing it would make the variable refer to itself, and it already has
 * its value from `tokens.css`.
 */
export function themeVariables(theme: UiKitTheme): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [variable, read] of TOKEN_VARIABLES) {
    const value = read(theme);
    if (value === `var(${variable})`) continue;
    variables[variable] = value;
  }
  return variables;
}

/** Every variable a theme can set, so a switch can take back the ones the previous theme wrote. */
export const THEME_VARIABLE_NAMES: readonly string[] = TOKEN_VARIABLES.map(
  ([variable]) => variable,
);
