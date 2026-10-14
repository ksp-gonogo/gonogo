import {
  act,
  installTestHost,
  renderHook,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCountdown } from "./InFlightList";

/** A view clock that has no time until the test gives it one, as before the first frame arrives. */
let ut: number | undefined;
let remove: (() => void) | undefined;

describe("useCountdown before the game clock has a time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ut = undefined;
    remove = installTestHost({
      useViewClockOptional: () => ({
        utNowEstimate: () => ut as number,
        confirmedEdgeUt: () => ut as number,
        onFrame: () => () => {},
      }),
    });
  });
  afterEach(() => {
    remove?.();
    vi.useRealTimers();
  });

  function wallSecond() {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }

  it("starts counting once the clock has a time, rather than holding its first figure", () => {
    const { result } = renderHook(() => useCountdown(240));
    wallSecond();
    expect(result.current).toBe(240);
    ut = 1000;
    wallSecond();
    ut = 1005;
    wallSecond();
    expect(result.current).toBe(235);
  });
});
