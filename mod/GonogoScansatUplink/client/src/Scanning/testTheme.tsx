import { DefaultThemeProvider } from "@ksp-gonogo/ui-kit";
import { type RenderResult, render } from "@testing-library/react";
import type { ReactElement } from "react";

/**
 * `render` wrapped with the real `ThemeProvider` (same theme the app mounts
 * in `main.tsx`). Needed once the widget composes kit primitives that read
 * `theme.space`/`theme.radii` (`Cluster`, `Grid`, `Stack`, `Section`'s inner
 * `Stack`, `Box`) — those crash without a theme in scope, and a bare
 * `render()` doesn't supply one.
 */
export function renderWithTheme(ui: ReactElement): RenderResult {
  return render(<DefaultThemeProvider>{ui}</DefaultThemeProvider>);
}
