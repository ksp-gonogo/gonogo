import {
  type RenderOptions,
  type RenderResult,
  render as rtlRender,
} from "@testing-library/react";
import type { JSXElementConstructor, ReactElement, ReactNode } from "react";
import { DefaultThemeProvider } from "../DefaultThemeProvider";

/**
 * The kit's own render — themed, like `@ksp-gonogo/test-utils`'s.
 *
 * The kit can't use that package: it depends on the kit for the theme, so the
 * kit depending back on it is a cycle. The kit is the base layer, so it owns
 * this one locally. Everywhere ELSE imports `@ksp-gonogo/test-utils`, which a
 * lint rule enforces.
 */

type Wrapper = JSXElementConstructor<{ children: ReactNode }>;

function withTheme(Extra?: Wrapper): Wrapper {
  if (!Extra) return DefaultThemeProvider;
  return function ThemedWrapper({ children }: { children: ReactNode }) {
    return (
      <DefaultThemeProvider>
        <Extra>{children}</Extra>
      </DefaultThemeProvider>
    );
  };
}

export function render(
  ui: ReactElement,
  options?: RenderOptions,
): RenderResult {
  return rtlRender(ui, { ...options, wrapper: withTheme(options?.wrapper) });
}

export * from "@testing-library/react";
