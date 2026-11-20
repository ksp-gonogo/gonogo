import { getTheme } from "@ksp-gonogo/core";
import { UiKitThemeProvider } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { DEFAULT_THEME_ID, useChosenThemeId } from "./themeChoice";

/**
 * Draws everything below it in the theme this device chose in Settings,
 * switching at once when the choice changes. Used by the app's root.
 */
export function ThemeHost({ children }: Readonly<{ children?: ReactNode }>) {
  const id = useChosenThemeId();
  const theme = (getTheme(id) ?? getTheme(DEFAULT_THEME_ID))?.theme;
  if (!theme) throw new Error("default-dark theme failed to register");
  return <UiKitThemeProvider theme={theme}>{children}</UiKitThemeProvider>;
}
