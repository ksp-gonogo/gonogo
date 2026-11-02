import { act, renderHook } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RendezvousLevel } from "./levels";
import { SETTLE_MS, STEP_MS, stepsBetween, useTurret } from "./useTurret";

describe("stepsBetween", () => {
  it("lists each level passed through, one at a time, in either direction", () => {
    expect(stepsBetween("craft", "far", "docking")).toEqual([
      "approach",
      "docking",
    ]);
    expect(stepsBetween("craft", "docking", "far")).toEqual([
      "approach",
      "far",
    ]);
    expect(stepsBetween("craft", "far", "approach")).toEqual(["approach"]);
  });

  it("lists nothing where there is nowhere to go, or a level the target does not have", () => {
    expect(stepsBetween("craft", "far", "far")).toEqual([]);
    expect(stepsBetween("body", "far", "docking")).toEqual([]);
  });
});

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

describe("useTurret", () => {
  let now = 0;
  let frames: Array<(t: number) => void> = [];

  beforeEach(() => {
    now = 0;
    frames = [];
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const runFrames = (to: number) => {
    while (frames.length > 0 && now < to) {
      now = Math.min(to, now + 100);
      const cbs = frames;
      frames = [];
      act(() => {
        for (const cb of cbs) cb(now);
      });
    }
  };

  it("starts on the wanted level with no step", () => {
    const { result } = renderHook(() => useTurret("craft", "far"));
    expect(result.current).toEqual({ shown: "far", step: null });
  });

  it("turns one step in over the step time and then holds the new level", () => {
    const { result, rerender } = renderHook(
      ({ level }: { level: RendezvousLevel }) => useTurret("craft", level),
      { initialProps: { level: "far" as RendezvousLevel } },
    );
    now = SETTLE_MS + 1;
    rerender({ level: "approach" });
    expect(result.current.step).toMatchObject({
      lower: "far",
      upper: "approach",
      goingIn: true,
      u: 0,
    });
    runFrames(now + STEP_MS / 2);
    expect(result.current.step?.u).toBeGreaterThan(0.3);
    expect(result.current.step?.u).toBeLessThan(0.7);
    runFrames(now + STEP_MS + 200);
    expect(result.current).toEqual({ shown: "approach", step: null });
  });

  it("runs a step backwards, from 1 down to 0, going out", () => {
    const { result, rerender } = renderHook(
      ({ level }: { level: RendezvousLevel }) => useTurret("craft", level),
      { initialProps: { level: "approach" as RendezvousLevel } },
    );
    now = SETTLE_MS + 1;
    rerender({ level: "far" });
    expect(result.current.step).toMatchObject({
      lower: "far",
      upper: "approach",
      goingIn: false,
      u: 1,
    });
    runFrames(now + STEP_MS + 200);
    expect(result.current.shown).toBe("far");
  });

  it("goes through every level between, one step after another", () => {
    const { result, rerender } = renderHook(
      ({ level }: { level: RendezvousLevel }) => useTurret("craft", level),
      { initialProps: { level: "far" as RendezvousLevel } },
    );
    now = SETTLE_MS + 1;
    rerender({ level: "docking" });
    runFrames(now + STEP_MS + 200);
    expect(result.current.shown).toBe("approach");
    runFrames(now + 2 * STEP_MS + 400);
    expect(result.current.shown).toBe("docking");
  });

  it("lands a change at once while the view is still settling, so channels arriving one after another are not paraded", () => {
    const { result, rerender } = renderHook(
      ({ level }: { level: RendezvousLevel }) => useTurret("craft", level),
      { initialProps: { level: "far" as RendezvousLevel } },
    );
    now = SETTLE_MS - 100;
    rerender({ level: "docking" });
    expect(result.current).toEqual({ shown: "docking", step: null });
  });

  it("jumps straight to the wanted level, with no step, when the operator asks for reduced motion", () => {
    setReducedMotion(true);
    const { result, rerender } = renderHook(
      ({ level }: { level: RendezvousLevel }) => useTurret("craft", level),
      { initialProps: { level: "far" as RendezvousLevel } },
    );
    rerender({ level: "docking" });
    expect(result.current).toEqual({ shown: "docking", step: null });
    expect(frames).toHaveLength(0);
  });
});
