import { act, renderHook } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTestGameClock } from "../test/gameClock";
import { useCountdown } from "./InFlightList";

const game = installTestGameClock();

describe("useCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** One wall second: the hook's redraw. */
  function wallSecond() {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }

  it("stands still while game time does, however much wall time passes", () => {
    const { result } = renderHook(() => useCountdown(240));
    for (let i = 0; i < 5; i++) wallSecond();
    expect(result.current).toBe(240);
  });

  it("falls by the game seconds that have passed, with no new figure from the caller", () => {
    const { result } = renderHook(() => useCountdown(240));
    game.advance(1);
    wallSecond();
    expect(result.current).toBe(239);
    game.advance(1);
    wallSecond();
    expect(result.current).toBe(238);
  });

  it("falls at the warp rate under time warp", () => {
    const { result } = renderHook(() => useCountdown(240));
    game.advance(100);
    wallSecond();
    expect(result.current).toBe(140);
  });

  it("never goes below zero", () => {
    const { result } = renderHook(() => useCountdown(3));
    game.advance(10);
    wallSecond();
    expect(result.current).toBe(0);
  });

  it("takes a new figure from the caller and counts on from it", () => {
    const { result, rerender } = renderHook(
      ({ eta }: { eta: number | null }) => useCountdown(eta),
      { initialProps: { eta: 240 as number | null } },
    );
    game.advance(10);
    rerender({ eta: 60 });
    expect(result.current).toBe(60);
    game.advance(5);
    wallSecond();
    expect(result.current).toBe(55);
  });

  it("is null while the caller has no figure", () => {
    const { result } = renderHook(() => useCountdown(null));
    game.advance(5);
    wallSecond();
    expect(result.current).toBeNull();
  });
});
