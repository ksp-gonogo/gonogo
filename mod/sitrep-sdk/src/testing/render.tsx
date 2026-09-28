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
 * Testing Library's `render` with the kit's theme always mounted, so a
 * `@ksp-gonogo/ui-kit` component renders without a provider of your own. A
 * `wrapper` you pass is mounted inside the theme.
 *
 * @category Rendering
 */
export function render(
  ui: ReactElement,
  options?: RenderOptions,
): RenderResult {
  return rtlRender(ui, { ...options, wrapper: withTheme(options?.wrapper) });
}

/**
 * Testing Library's `renderHook` with the kit's theme always mounted. A
 * `wrapper` you pass is mounted inside the theme.
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
 * What a test PROBE should print for a value that may or may not carry a unit.
 *
 * A probe exists to prove a read path works: that a frame reached a widget, that
 * a subscription fired, that a shim routed to the stream. How the value RENDERS is
 * not what it is testing, and a `Value`'s own `toString` is "0.75 ratio", which
 * turns every such assertion into a question about the unit system instead of
 * about the wiring.
 *
 * So: the magnitude for a quantity, the value itself for anything else. Use
 * `visibleText` from `@ksp-gonogo/ui-kit/testing` when what a reader SEES is the
 * point.
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
