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

/**
 * The render an Uplink's tests use.
 *
 * Every `@ksp-gonogo/ui-kit` primitive reads `theme.space[...]` / `theme.colors[...]`
 * straight off the styled-components theme. With no provider in scope
 * styled-components hands it `{}`, so `theme.colors.text.primary` is a property
 * access on `undefined` and the render throws: not a guard, not a fallback, a
 * TypeError. That is a surprise every single time, and the module that knew about
 * it used to be `@ksp-gonogo/test-utils`, which is `private: true` and which a
 * third-party Uplink author therefore cannot install. 56 Uplink client files
 * imported it anyway, every one of them a file nobody outside this repo could run.
 *
 * So the theme is ON, always, from here. A test that renders a kit primitive needs
 * no setup call and no provider of its own, and one that renders no primitive pays
 * nothing: `ThemeProvider` emits no DOM, so wrapping unconditionally is invisible
 * to a snapshot.
 *
 * Testing Library and styled-components are OPTIONAL peers, and this module is
 * reached only through `@ksp-gonogo/sitrep-sdk/testing`, a separate entry from the
 * root barrel. A runtime consumer of the sdk never resolves it, so nothing here
 * reaches a shipped bundle.
 */

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
 */
export function probeText(v: unknown): string {
  return String(
    v !== null && typeof v === "object" && "magnitude" in v
      ? (v as { magnitude: unknown }).magnitude
      : v,
  );
}
