import type { ReactNode } from "react";
import { ThemeProvider } from "styled-components";
import { defaultDarkTheme } from "./defaultDarkTheme";

export interface DefaultThemeProviderProps {
  children?: ReactNode;
}

/**
 * Mounts the kit's default dark theme — the same one the app mounts in
 * `main.tsx`.
 *
 * Kit primitives read `theme.space`/`theme.colors` and throw without a
 * `ThemeProvider` in scope, so every surface that renders them outside the
 * app's own provider (tests, the snapshot harness, embedded slots) needs the
 * pairing of `ThemeProvider` + `defaultDarkTheme`. Re-deriving that pairing at
 * each call site is what spread a `styled-components` import across a dozen
 * test files and three copies of a local `testTheme` helper; this is the one
 * place it lives now.
 */
export function DefaultThemeProvider({
  children,
}: Readonly<DefaultThemeProviderProps>) {
  return <ThemeProvider theme={defaultDarkTheme}>{children}</ThemeProvider>;
}
