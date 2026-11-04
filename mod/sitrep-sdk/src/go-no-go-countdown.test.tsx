// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { useGoNoGoCountdown, useLiftoffCountdown } from "./go-no-go-countdown";
import { stageCountdownStore } from "./spine/stage-countdown-store";
import { act, renderHook } from "./testing";

afterEach(() => {
  act(() => stageCountdownStore.clear());
  vi.useRealTimers();
});

const start = (liftsOff: boolean) =>
  stageCountdownStore.start({
    remainingSeconds: 10,
    lengthSeconds: 10,
    liftsOff,
  });

describe("useGoNoGoCountdown", () => {
  it("is null until a countdown has started", () => {
    const { result } = renderHook(() => useGoNoGoCountdown());
    expect(result.current).toBeNull();
  });

  it("counts down while running and reports how it ended", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useGoNoGoCountdown());
    act(() => start(false));
    expect(result.current).toMatchObject({
      running: true,
      lengthSeconds: 10,
      ended: null,
    });
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current?.remainingSeconds).toBeCloseTo(6, 0);
    act(() => stageCountdownStore.end("go"));
    expect(result.current).toEqual({
      running: false,
      remainingSeconds: 0,
      lengthSeconds: 10,
      ended: "go",
    });
  });

  it("reports an abort", () => {
    const { result } = renderHook(() => useGoNoGoCountdown());
    act(() => start(false));
    act(() => stageCountdownStore.end("aborted"));
    expect(result.current?.ended).toBe("aborted");
  });
});

describe("useLiftoffCountdown", () => {
  it("is null for a countdown that does not lift the craft off the pad", () => {
    const { result } = renderHook(() => useLiftoffCountdown());
    act(() => start(false));
    expect(result.current).toBeNull();
  });

  it("runs from the start of a liftoff countdown and keeps the liftoff after T-0", () => {
    const { result } = renderHook(() => useLiftoffCountdown());
    act(() => start(true));
    expect(result.current).toMatchObject({
      lengthSeconds: 10,
      liftedOff: false,
    });
    act(() => stageCountdownStore.end("go"));
    expect(result.current).toMatchObject({
      remainingSeconds: 0,
      liftedOff: false,
    });
    act(() => stageCountdownStore.setLiftedOff(true));
    expect(result.current?.liftedOff).toBe(true);
  });

  it("is null again after an abort and after the craft is back on the pad", () => {
    const { result } = renderHook(() => useLiftoffCountdown());
    act(() => start(true));
    act(() => stageCountdownStore.end("aborted"));
    expect(result.current).toBeNull();
    act(() => start(true));
    act(() => stageCountdownStore.end("go"));
    act(() => stageCountdownStore.clear());
    expect(result.current).toBeNull();
  });
});
