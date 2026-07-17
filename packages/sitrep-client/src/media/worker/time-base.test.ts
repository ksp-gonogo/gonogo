import { describe, expect, it } from "vitest";
import { computeTimeOriginOffsetMs, createNowWall } from "./time-base";

describe("computeTimeOriginOffsetMs", () => {
  it("is localTimeOrigin - mainTimeOrigin (the amount to ADD to a local reading)", () => {
    expect(computeTimeOriginOffsetMs(1_000_000, 1_000_500)).toBe(500);
    expect(computeTimeOriginOffsetMs(2_000_000, 1_000_000)).toBe(-1_000_000);
    expect(computeTimeOriginOffsetMs(500, 500)).toBe(0);
  });
});

describe("createNowWall", () => {
  it("returns 0 with zero offset and zero local elapsed time", () => {
    const nowWall = createNowWall(0, () => 0);
    expect(nowWall()).toBe(0);
  });

  it("converts local perfNowMs (ms) to seconds when the two origins coincide", () => {
    const nowWall = createNowWall(0, () => 5000);
    expect(nowWall()).toBe(5);
  });

  it("worked example: worker starting later than the main thread still lands on the main thread's basis", () => {
    // Main thread's page loaded at absolute epoch 1000ms; the worker spins
    // up 500ms later, at absolute epoch 1500ms.
    const mainTimeOriginMs = 1000;
    const localTimeOriginMs = 1500;
    const offset = computeTimeOriginOffsetMs(
      mainTimeOriginMs,
      localTimeOriginMs,
    );
    expect(offset).toBe(500);

    // 500ms of real time after the worker started (absolute epoch 2000ms),
    // the worker's own performance.now() reads 500 (2000 - 1500).
    const nowWall = createNowWall(offset, () => 500);
    // The main thread's own performance.now()/1000 at that same absolute
    // instant would read (2000 - 1000) / 1000 = 1.0 — that's what nowWall()
    // must reproduce from purely the worker's local reading + the offset.
    expect(nowWall()).toBe(1.0);
  });

  it("a worker starting BEFORE the main thread's origin (negative offset) also reconciles correctly", () => {
    // Pathological but should still hold algebraically: worker's origin at
    // absolute epoch 1000ms, main thread's origin 500ms LATER at 1500ms.
    const offset = computeTimeOriginOffsetMs(1500, 1000);
    expect(offset).toBe(-500);

    // 2000ms after the worker's own origin (absolute epoch 3000ms): main
    // thread's basis reading = (3000 - 1500) / 1000 = 1.5.
    const nowWall = createNowWall(offset, () => 2000);
    expect(nowWall()).toBe(1.5);
  });

  it("is injectable — never touches the real performance object", () => {
    let calls = 0;
    const nowWall = createNowWall(1000, () => {
      calls += 1;
      return 500;
    });
    nowWall();
    nowWall();
    expect(calls).toBe(2);
  });
});
