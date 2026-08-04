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
 * `@testing-library/react` directly: a lint rule enforces it.
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

// `visibleText` deliberately does NOT live here, and is not re-exported from
// here either. It belongs to `@ksp-gonogo/ui-kit/testing`, because the kit
// that SPLITS a readout should ship the way to read it back, and because that
// package is published where this one is private: an Uplink author outside
// this repo can install it and cannot install this. Re-exporting it for
// convenience made test-utils depend on ui-kit, which ui-kit already depends
// on for its own tests, and turbo rejects the build cycle. One definition,
// one import path.
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
 * `visibleText` when what a reader SEES is the point.
 */
export function probeText(v: unknown): string {
  return String(
    v !== null && typeof v === "object" && "magnitude" in v
      ? (v as { magnitude: unknown }).magnitude
      : v,
  );
}
