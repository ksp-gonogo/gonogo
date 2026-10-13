import type { ReactNode } from "react";
import { defaultDarkTheme } from "./defaultDarkTheme";
import { UiKitThemeProvider } from "./UiKitThemeProvider";

/**
 * Props for {@link DefaultThemeProvider}.
 *
 * @category Theme
 */
export interface DefaultThemeProviderProps {
  children?: ReactNode;
}

/**
 * Mounts {@link defaultDarkTheme} through {@link UiKitThemeProvider}, the same
 * theme the app mounts. Useful for rendering a component outside the app (a
 * test, a story, a standalone page) whose own styles read `theme.colors`
 * through a styled-components callback.
 *
 * The kit's components draw from the CSS variables that
 * `@ksp-gonogo/ui-kit/tokens.css` defines, so import that sheet once: without
 * it every colour and size is unset, whichever theme is mounted.
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
  return (
    <UiKitThemeProvider theme={defaultDarkTheme}>{children}</UiKitThemeProvider>
  );
}
