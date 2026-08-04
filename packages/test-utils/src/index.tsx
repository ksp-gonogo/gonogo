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

// Explicit exports above take precedence over this star re-export, so `render`
// and `renderHook` resolve to the themed versions while the rest of RTL's
// surface passes straight through.
export * from "@testing-library/react";

/**
 * The text a SIGHTED reader sees, with screen-reader-only content removed.
 *
 * `textContent` includes the visually-hidden word `Unit` puts in the
 * accessibility tree, so a readout showing "12.4 km" reads back as
 * "12.4 km kilometres" and every assertion on rendered text has to know that.
 * That is a detail of how units are announced, not of what a widget renders,
 * and it should not be restated in a hundred widget tests.
 *
 * Assert on this for what is on screen. Assert on `textContent` directly when
 * the ANNOUNCEMENT is the thing under test, or better, use
 * `screen.getByText("kilometres")`, which says so.
 *
 * Defaults to `document.body`, so an assertion about what is on screen needs
 * no container plumbed to it: `expect(visibleText()).toContain("12.4 km")` is
 * the whole of it. Pass a container when a test renders more than one thing
 * and needs to say which.
 *
 * The thin space between a number and its unit is normalised to an ordinary
 * one. A reader sees a space; which space it is is a typographic detail, and
 * one that produces assertion failures reading `expected "12.4 km" to be
 * "12.4 km"`. The character itself is pinned by its own test in `Unit`, where
 * it means something.
 */
export function visibleText(container: HTMLElement = document.body): string {
  const clone = container.cloneNode(true) as HTMLElement;
  for (const hidden of clone.querySelectorAll("[data-unit-word]")) {
    hidden.remove();
  }
  return (clone.textContent ?? "").replace(/\u2009/g, " ");
}

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
