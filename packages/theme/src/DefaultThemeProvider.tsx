import type { ReactNode } from "react";
import { ThemeProvider } from "styled-components";
import { defaultDarkTheme } from "./defaultDarkTheme";

/**
 * Props for {@link DefaultThemeProvider}.
 *
 * @category Theme
 */
export interface DefaultThemeProviderProps {
  children?: ReactNode;
}

/**
 * Mounts {@link defaultDarkTheme} in a styled-components `ThemeProvider`, the
 * same theme the app mounts.
 *
 * Kit components read `theme.colors` and throw without a theme in scope, so
 * wrap anything that renders them outside the app (a test, a story, a
 * standalone page) in this. The theme's values are CSS variables, which
 * `@ksp-gonogo/ui-kit/tokens.css` defines: import that sheet once, or every
 * colour and size is unset.
 *
 * @example
 * ```tsx
 * import "@ksp-gonogo/ui-kit/tokens.css";
 * import { value } from "@ksp-gonogo/sitrep-sdk";
 * import { DefaultThemeProvider, Meter } from "@ksp-gonogo/ui-kit";
 * import { render } from "@testing-library/react";
 *
 * render(
 *   <DefaultThemeProvider>
 *     <Meter label="Charge" value={value("ratio", 0.4)} />
 *   </DefaultThemeProvider>,
 * );
 * ```
 *
 * @category Theme
 */
export function DefaultThemeProvider({
  children,
}: Readonly<DefaultThemeProviderProps>) {
  return <ThemeProvider theme={defaultDarkTheme}>{children}</ThemeProvider>;
}
