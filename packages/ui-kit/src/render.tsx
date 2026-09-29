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
 * does; this is the same rail around the sdk's themed `render`/`renderHook`,
 * for a component or hook under test that is not a registered widget.
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
 * The sdk's themed `render`, with a command rail mounted above it.
 *
 * @category Rendering
 */
export function render(
  ui: ReactElement,
  options?: RenderOptions,
): RenderResult {
  return sdkRender(ui, { ...options, wrapper: withRail(options?.wrapper) });
}

/**
 * `renderHook`, with the same rail as {@link render}.
 *
 * @category Rendering
 */
export function renderHook<Result, Props>(
  callback: (initialProps: Props) => Result,
  options?: RenderHookOptions<Props>,
): RenderHookResult<Result, Props> {
  return sdkRenderHook(callback, {
    ...options,
    wrapper: withRail(options?.wrapper),
  });
}
