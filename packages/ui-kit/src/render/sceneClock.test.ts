// @vitest-environment node
//
// Node realm: the clock replaces `globalThis`'s four timer functions and reads
// no DOM. What it guards is that a film's callbacks fall on the frame the
// fixture asks for rather than on the frame the machine happened to reach.
import { afterEach, describe, expect, it } from "vitest";
import {
  advanceSceneClock,
  closeSceneClock,
  openSceneClock,
  sceneClockIsSealed,
  sceneClockNow,
  sealSceneClock,
} from "./sceneClock";

afterEach(() => {
  closeSceneClock();
});

/** A real wait, taken before the clock is opened so it is the page's own. */
const realWait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("the scene clock", () => {
  it("fires a sealed timeout when the scene reaches its delay, not before", () => {
    openSceneClock();
    sealSceneClock();
    const fired: number[] = [];
    setTimeout(() => fired.push(sceneClockNow()), 900);

    advanceSceneClock(600);
    expect(fired).toEqual([]);
    advanceSceneClock(600);
    expect(fired).toEqual([900]);
    // A one-shot fires once however far the clock runs on.
    advanceSceneClock(5000);
    expect(fired).toEqual([900]);
  });

  it("fires an interval once per period, in step with the timeouts", () => {
    openSceneClock();
    sealSceneClock();
    const order: string[] = [];
    setInterval(() => order.push(`tick@${sceneClockNow()}`), 100);
    setTimeout(() => order.push(`out@${sceneClockNow()}`), 250);

    advanceSceneClock(300);
    expect(order).toEqual(["tick@100", "tick@200", "out@250", "tick@300"]);
  });

  it("fires the same sequence however the wait is split across frames", () => {
    const run = (frames: number): string[] => {
      openSceneClock();
      sealSceneClock();
      const seen: string[] = [];
      setInterval(() => seen.push(`tick@${sceneClockNow()}`), 60);
      setTimeout(() => seen.push(`release@${sceneClockNow()}`), 140);
      for (let i = 0; i < frames; i++) advanceSceneClock(240 / frames);
      closeSceneClock();
      return seen;
    };
    expect(run(8)).toEqual(run(2));
    expect(run(8)).toContain("release@140");
  });

  it("clears a sealed timer by the handle it handed out", () => {
    openSceneClock();
    sealSceneClock();
    const fired: string[] = [];
    const timeout = setTimeout(() => fired.push("timeout"), 50);
    const interval = setInterval(() => fired.push("interval"), 50);
    clearTimeout(timeout);
    clearInterval(interval);

    advanceSceneClock(500);
    expect(fired).toEqual([]);
  });

  it("lets a sealed timeout schedule its successor without resurrecting itself", () => {
    openSceneClock();
    sealSceneClock();
    const fired: number[] = [];
    const again = () => {
      fired.push(sceneClockNow());
      if (fired.length < 3) setTimeout(again, 100);
    };
    setTimeout(again, 100);

    advanceSceneClock(1000);
    expect(fired).toEqual([100, 200, 300]);
  });

  it("refuses to spin forever on a handler that reschedules faster than time moves", () => {
    openSceneClock();
    sealSceneClock();
    const again = () => {
      setTimeout(again, 0);
    };
    setTimeout(again, 0);

    expect(() => advanceSceneClock(10)).toThrow(/without draining/);
  });

  describe("while the scene is still being set up", () => {
    it("runs a timeout for real, so a setup hook can await one", async () => {
      openSceneClock();
      expect(sceneClockIsSealed()).toBe(false);
      let resolved = false;
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolved = true;
          resolve();
        }, 5);
      });
      expect(resolved).toBe(true);
    });

    it("carries a timeout the setup left pending into the film at its nominal delay", async () => {
      openSceneClock();
      const fired: number[] = [];
      setTimeout(() => fired.push(sceneClockNow()), 1400);
      /*
       * Whatever the page spends settling before the first frame, the release is
       * 1400ms into the FILM: the remainder a real clock would have counted
       * down is exactly what the seal throws away.
       */
      await realWait(30);
      sealSceneClock();

      advanceSceneClock(1300);
      expect(fired).toEqual([]);
      advanceSceneClock(200);
      expect(fired).toEqual([1400]);
    });

    it("does not carry a timeout that already fired", async () => {
      openSceneClock();
      const fired: string[] = [];
      setTimeout(() => fired.push("early"), 1);
      await realWait(30);
      sealSceneClock();

      advanceSceneClock(5000);
      expect(fired).toEqual(["early"]);
    });

    it("does not carry a timeout the setup cleared", async () => {
      openSceneClock();
      const fired: string[] = [];
      const handle = setTimeout(() => fired.push("late"), 1400);
      clearTimeout(handle);
      sealSceneClock();

      advanceSceneClock(5000);
      expect(fired).toEqual([]);
    });

    it("holds an interval from the mount, so no tick lands before frame zero", async () => {
      openSceneClock();
      const ticks: number[] = [];
      setInterval(() => ticks.push(sceneClockNow()), 10);
      await realWait(50);
      expect(ticks).toEqual([]);
      sealSceneClock();

      advanceSceneClock(25);
      expect(ticks).toEqual([10, 20]);
    });
  });

  it("gives the page its own timers back, and cancels what the scene left live", async () => {
    const own = {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    };
    openSceneClock();
    expect(globalThis.setTimeout).not.toBe(own.setTimeout);
    const fired: string[] = [];
    setTimeout(() => fired.push("leaked into the next scene"), 10);
    closeSceneClock();

    expect(globalThis.setTimeout).toBe(own.setTimeout);
    expect(globalThis.clearTimeout).toBe(own.clearTimeout);
    expect(globalThis.setInterval).toBe(own.setInterval);
    expect(globalThis.clearInterval).toBe(own.clearInterval);
    await realWait(40);
    expect(fired).toEqual([]);
  });
});
