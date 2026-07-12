import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";
import { type RenderResult, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { ThemeProvider } from "styled-components";

/**
 * `render` wrapped with the real `ThemeProvider` (same theme the app mounts
 * in `main.tsx`). Needed once the widget composes kit primitives that read
 * `theme.space` (`Cluster`/`Section`, and `ScienceExperimentRow`'s `Inline`)
 * — those crash without a theme in scope, and a bare `render()` doesn't
 * supply one.
 */
export function renderWithTheme(ui: ReactElement): RenderResult {
  return render(<ThemeProvider theme={defaultDarkTheme}>{ui}</ThemeProvider>);
}
