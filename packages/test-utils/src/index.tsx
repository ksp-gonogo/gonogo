/**
 * The project's render, for the packages inside this repo.
 *
 * It is no longer defined here. `render`/`renderHook` mount the kit's theme, which
 * every ui-kit primitive reads straight off the styled-components context, and they
 * now live in `@ksp-gonogo/sitrep-sdk/testing` where a third-party Uplink author
 * can install them. This module is the short import path the app-side packages
 * already use, kept so several hundred call sites do not have to move to say the
 * same thing.
 *
 * **New code should import `@ksp-gonogo/sitrep-sdk/testing` directly.** An Uplink
 * client MUST: this package is `private: true`, and
 * `packages/core/src/uplink-isolation.test.ts` fails on it.
 *
 * `visibleText` and the unit matchers are in `@ksp-gonogo/ui-kit/testing` (no
 * React, no DOM), a separate entry so a runtime bundle never pulls React test code
 * in.
 */

import {
  type RenderHookOptions,
  type RenderHookResult,
  type RenderOptions,
  type RenderResult,
  render as sdkRender,
  renderHook as sdkRenderHook,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { DelayRailProvider } from "@ksp-gonogo/ui-kit";
import type { JSXElementConstructor, ReactElement, ReactNode } from "react";

export * from "@ksp-gonogo/sitrep-sdk/testing";

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

export function render(
  ui: ReactElement,
  options?: RenderOptions,
): RenderResult {
  return sdkRender(ui, { ...options, wrapper: withRail(options?.wrapper) });
}

export function renderHook<Result, Props>(
  callback: (initialProps: Props) => Result,
  options?: RenderHookOptions<Props>,
): RenderHookResult<Result, Props> {
  return sdkRenderHook(callback, {
    ...options,
    wrapper: withRail(options?.wrapper),
  });
}
