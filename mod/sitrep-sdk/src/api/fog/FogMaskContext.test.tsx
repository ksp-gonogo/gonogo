// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderHook } from "../../testing";
import { useFogMaskCache, useFogMaskStore } from "./FogMaskContext";

/**
 * `useFogMaskCache` was a host SHIM until 2026-08-19, so an Uplink's hook would
 * read the app's cache rather than a bundled copy of the context. The context lives
 * in this package now, so there is no second copy and the hook is the real one.
 *
 * Its own file, with its own jsdom environment, because the sdk suite runs in
 * `node` and a hook needs a render. `spi.test.ts`, where the shim version was
 * checked, has forty node-environment assertions that would have had to move with
 * it.
 */
describe("fog mask context, with no provider mounted", () => {
  it("answers null rather than throwing, because fog is optional", () => {
    // The contract the callers rely on: a widget with no fog provider above it
    // skips the fog pipeline. A throw here would take out every dashboard that
    // does not use fog at all.
    const { result } = renderHook(() => useFogMaskCache());
    expect(result.current).toBeNull();
  });

  it("answers null for the store too, on the same contract", () => {
    const { result } = renderHook(() => useFogMaskStore());
    expect(result.current).toBeNull();
  });
});
