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
 * The project's render, published as `@ksp-gonogo/ui-kit/testing-react`.
 *
 * Kit primitives read `theme.space`/`theme.colors` and throw without a
 * `ThemeProvider` in scope, so every render of one needs a theme. That is a
 * fact about THIS kit, which is why the render that supplies it ships from
 * here: the same argument `./testing` already makes for `visibleText`, that
 * the kit which splits a readout should ship the way to read it back.
 *
 * It lived in `@ksp-gonogo/test-utils` until 2026-08-18, and that package is
 * `private: true`. So an Uplink author outside this repo had no way to render
 * a widget built out of kit primitives at all: the theme requirement is
 * undocumented at the point of failure, and the one module that knew about it
 * was unpublishable. 56 Uplink client files were reaching for it, every one of
 * them a file a third-party author could not run.
 *
 * Separate entry from `./testing`, which documents that it imports nothing
 * from React and nothing from the DOM so a runtime bundle never pulls testing
 * code in. `@testing-library/react` is an optional peer here: a consumer who
 * tests widgets already has it, and one who does not never resolves this
 * module.
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

/**
 * What a test PROBE should print for a value that may or may not carry a unit.
 *
 * A probe exists to prove a read path works: that a frame reached a widget,
 * that a subscription fired, that a shim routed to the stream. It is not the
 * thing under test how the value renders, and a `Value`'s own `toString` is
 * "0.75 ratio", which turns every such assertion into a question about the
 * unit system instead of about the wiring.
 *
 * So: the magnitude for a quantity, the value itself for anything else. Use
 * `visibleText` from `./testing` when what a reader SEES is the point.
 */
export function probeText(v: unknown): string {
  return String(
    v !== null && typeof v === "object" && "magnitude" in v
      ? (v as { magnitude: unknown }).magnitude
      : v,
  );
}
