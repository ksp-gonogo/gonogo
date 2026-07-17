import { DefaultThemeProvider } from "@ksp-gonogo/theme";
import {
  type RenderHookOptions,
  type RenderHookResult,
  type RenderOptions,
  type RenderResult,
  render as rtlRender,
  renderHook as rtlRenderHook,
} from "@testing-library/react";
import type { JSXElementConstructor, ReactElement, ReactNode } from "react";

/**
 * The project's render. Import `render`/`renderHook` from here, never from
 * `@testing-library/react` directly — a lint rule enforces it.
 *
 * Kit primitives read `theme.space`/`theme.colors` and throw without a
 * `ThemeProvider` in scope, so every render needs one. Leaving that to each
 * call site is what spread a `styled-components` import across a dozen test
 * files and three copies of a local `testTheme` helper, and inflated the
 * styled-components ratchet with test infrastructure it couldn't tell apart
 * from widget CSS. The theme lives here instead: it is always on, and no test
 * has to remember it.
 *
 * `ThemeProvider` renders no DOM of its own, so wrapping unconditionally is
 * invisible to snapshots.
 *
 * Everything else re-exports from `@testing-library/react` unchanged
 * (`screen`, `waitFor`, `within`, `act`, `fireEvent`, `cleanup`, …), so this
 * module is a drop-in for the import source.
 */

type Wrapper = JSXElementConstructor<{ children: ReactNode }>;

/**
 * Composes rather than replaces: a caller's `wrapper` nests INSIDE the theme,
 * so injecting extra providers (a TelemetryProvider, a router) never silently
 * drops the theme underneath it.
 */
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

export function renderHook<Result, Props>(
  render: (initialProps: Props) => Result,
  options?: RenderHookOptions<Props>,
): RenderHookResult<Result, Props> {
  return rtlRenderHook(render, {
    ...options,
    wrapper: withTheme(options?.wrapper),
  });
}

// Explicit exports above take precedence over this star re-export, so `render`
// and `renderHook` resolve to the themed versions while the rest of RTL's
// surface passes straight through.
export * from "@testing-library/react";
