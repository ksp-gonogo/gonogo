import {
  type RenderHookOptions,
  type RenderHookResult,
  type RenderOptions,
  type RenderResult,
  render as rtlRender,
  renderHook as rtlRenderHook,
} from "@testing-library/react";
import type { JSXElementConstructor, ReactElement, ReactNode } from "react";
import { createElement } from "react";
import { ThemeProvider } from "styled-components";
import { harnessTheme } from "./theme";

// A kit primitive reads `theme.colors` off styled-components' context and throws a TypeError without a provider; spacing and radii resolve without one.
type Wrapper = JSXElementConstructor<{ children: ReactNode }>;

/**
 * Composes rather than replaces: a caller's own `wrapper` nests INSIDE the theme,
 * so adding a `TelemetryProvider` or a router never silently drops the theme
 * underneath it and turns every kit primitive into a TypeError.
 */
function withTheme(Extra?: Wrapper): Wrapper {
  return function HarnessWrapper({ children }: { children: ReactNode }) {
    return createElement(
      ThemeProvider,
      { theme: harnessTheme },
      Extra ? createElement(Extra, null, children) : children,
    );
  };
}

/**
 * The render function of `@testing-library/react` with the kit's theme always
 * mounted, so a `@ksp-gonogo/ui-kit` component renders without a provider of
 * your own. A `wrapper` you pass is mounted inside the theme. It needs
 * `@testing-library/react` and `styled-components` installed, and a DOM test
 * environment such as jsdom.
 *
 * @category Rendering
 * @categoryDescription Rendering
 * Rendering a widget or a hook in a test with the theme and DOM stubs it needs,
 * and reading its text the way an operator sees it.
 */
export function render(
  ui: ReactElement,
  options?: RenderOptions,
): RenderResult {
  return rtlRender(ui, { ...options, wrapper: withTheme(options?.wrapper) });
}

/**
 * The hook-rendering function of `@testing-library/react` with the kit's
 * theme always mounted. A `wrapper` you pass is mounted inside the theme.
 *
 * @category Rendering
 */
export function renderHook<Result, Props>(
  render: (initialProps: Props) => Result,
  options?: RenderHookOptions<Props>,
): RenderHookResult<Result, Props> {
  return rtlRenderHook(render, {
    ...options,
    wrapper: withTheme(options?.wrapper),
  });
}

/**
 * The text a test probe should print for a value. A probe is a small test
 * component that prints what a hook returned so a test can assert on it. A
 * quantity (a `Value`, which pairs a magnitude with its unit) prints as its
 * magnitude, and anything else as it is. For a test of whether a value arrived, not of how
 * it is drawn; use `visibleText` from `@ksp-gonogo/ui-kit/testing` for what a
 * reader sees.
 *
 * @category Rendering
 */
export function probeText(v: unknown): string {
  return String(
    v !== null && typeof v === "object" && "magnitude" in v
      ? (v as { magnitude: unknown }).magnitude
      : v,
  );
}
