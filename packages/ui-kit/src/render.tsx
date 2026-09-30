import {
  type RenderHookOptions,
  type RenderHookResult,
  type RenderOptions,
  type RenderResult,
  render as sdkRender,
  renderHook as sdkRenderHook,
} from "@ksp-gonogo/sitrep-sdk/testing";
import type { JSXElementConstructor, ReactElement, ReactNode } from "react";
import { DelayRailProvider } from "./CommandDelay/DelayRailContext";

/**
 * The bare rail-mounted render, published so an Uplink test can dispatch a
 * command with nothing private.
 *
 * `useCommand` registers every handle it returns with the nearest command
 * rail and a dev build throws on the first dispatch with none mounted (see
 * `DelayRailProvider`). `renderWidget` already carries one, as the dashboard
 * does; `renderWithRail`/`renderHookWithRail` are the same rail around the
 * sdk's themed `render`/`renderHook`, for a component or hook under test that
 * is not a registered widget. Named apart from the sdk's own `render`/
 * `renderHook` rather than shadowing them: both packages are published, and
 * `styleguide-shared-published-surface.test.ts` fails a name declared in both.
 *
 * Lives in ui-kit rather than the sdk because `DelayRailProvider` is ui-kit's:
 * the sdk owns the `RailRegistry` seam it implements, but not the store or the
 * `Panel` wiring behind it, and the sdk cannot import ui-kit back (ui-kit
 * imports the sdk, so the reverse edge would be a build cycle). ui-kit already
 * carries `@ksp-gonogo/sitrep-sdk` as a dependency for `renderWidget`, so this
 * module reaches the sdk's `render`/`renderHook` the same way.
 */

type Wrapper = JSXElementConstructor<{ children: ReactNode }>;

/** A command rail around the tree, as the dashboard mounts one around every widget. A caller's own `wrapper` nests inside it. */
function withRail(Extra?: Wrapper): Wrapper {
  return function RailWrapper({ children }: { children: ReactNode }) {
    return (
      <DelayRailProvider>
        {Extra ? <Extra>{children}</Extra> : children}
      </DelayRailProvider>
    );
  };
}

/**
 * The sdk's themed `render` (from `@ksp-gonogo/sitrep-sdk/testing`), with a
 * command rail mounted above it, for a component under test that dispatches
 * through `useCommand` but is not a registered widget. A dev build throws on a
 * dispatch with no rail mounted. A caller's own `wrapper` nests inside the
 * rail. For a registered widget use {@link renderWidget}, which carries one.
 *
 * @category Testing
 */
export function renderWithRail(
  ui: ReactElement,
  options?: RenderOptions,
): RenderResult {
  return sdkRender(ui, { ...options, wrapper: withRail(options?.wrapper) });
}

/**
 * The sdk's `renderHook`, with the same command rail as {@link renderWithRail},
 * for a hook under test that calls `useCommand`.
 *
 * @category Testing
 */
export function renderHookWithRail<Result, Props>(
  callback: (initialProps: Props) => Result,
  options?: RenderHookOptions<Props>,
): RenderHookResult<Result, Props> {
  return sdkRenderHook(callback, {
    ...options,
    wrapper: withRail(options?.wrapper),
  });
}
