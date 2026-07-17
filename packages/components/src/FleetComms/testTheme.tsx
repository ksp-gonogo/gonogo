import { DefaultThemeProvider } from "@ksp-gonogo/ui-kit";
import { type RenderResult, render } from "@testing-library/react";
import type { ReactElement } from "react";

/**
 * `render` wrapped with the real `ThemeProvider` (same theme the app mounts
 * in `main.tsx`) — needed because the actions augment composes `Cluster`
 * (`@ksp-gonogo/ui-kit`), which reads `theme.space`; a bare `render()`
 * doesn't supply one and the component crashes. Mirrors
 * `ScienceOfficer/testTheme.tsx`'s identical helper (same underlying need,
 * kept local rather than shared — matches this codebase's own small-helper
 * duplication precedent, e.g. `frameNameMatches`/`nameMatches`).
 */
export function renderWithTheme(ui: ReactElement): RenderResult {
  return render(<DefaultThemeProvider>{ui}</DefaultThemeProvider>);
}
