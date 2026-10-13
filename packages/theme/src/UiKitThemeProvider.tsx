import { type ReactNode, useLayoutEffect } from "react";
import { ThemeProvider } from "styled-components";
import type { UiKitTheme } from "./theme";
import { THEME_VARIABLE_NAMES, themeVariables } from "./themeVariables";

/**
 * Props for {@link UiKitThemeProvider}.
 *
 * @category Theme
 */
export interface UiKitThemeProviderProps {
  /** The theme to draw with, such as one registered with `registerTheme`. Changing it switches every widget at once. */
  theme: UiKitTheme;
  /** What the theme applies to. */
  children?: ReactNode;
}

/**
 * Applies a theme to everything below it: its colours and type are written
 * onto the CSS variables of `@ksp-gonogo/ui-kit/tokens.css` on the page's root
 * element, which the kit's components draw from, and the same object is the
 * styled-components `theme`. Useful for restyling every widget on the
 * operator's screen from one registered theme, and for switching between
 * themes while the app runs. Used by {@link DefaultThemeProvider} and by the
 * app's root.
 *
 * A token whose value is the variable it sets keeps the value `tokens.css`
 * gives it. Switching theme takes back every variable the previous theme
 * wrote, and unmounting takes back them all.
 *
 * @category Theme
 */
export function UiKitThemeProvider({
  theme,
  children,
}: Readonly<UiKitThemeProviderProps>) {
  // Before paint, so a switch never shows one frame of the old palette.
  useLayoutEffect(() => {
    const root = document.documentElement;
    for (const [variable, value] of Object.entries(themeVariables(theme))) {
      root.style.setProperty(variable, value);
    }
    return () => {
      for (const variable of THEME_VARIABLE_NAMES) {
        root.style.removeProperty(variable);
      }
    };
  }, [theme]);
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
