import { describe, expect, it } from "vitest";
import { ManualClock } from "./clock";

describe("ManualClock", () => {
  it("starts at UT 0 by default", () => {
    const clock = new ManualClock();
    expect(clock.now()).toBe(0);
  });

  it("starts at the given UT when provided", () => {
    const clock = new ManualClock(100);
    expect(clock.now()).toBe(100);
  });

  it("advanceTo fires only callbacks with atUt <= target, and sets now()", () => {
    const clock = new ManualClock();
    const firedA: number[] = [];
    const firedB: number[] = [];

    clock.schedule(10, () => firedA.push(clock.now()));
    clock.schedule(5, () => firedB.push(clock.now()));

    clock.advanceTo(7);

    expect(firedB).toEqual([7]);
    expect(firedA).toEqual([]);
    expect(clock.now()).toBe(7);

    clock.advanceTo(12);

    expect(firedA).toEqual([12]);
    expect(firedB).toEqual([7]);
    expect(clock.now()).toBe(12);
  });

  it("fires due callbacks in ascending atUt order", () => {
    const clock = new ManualClock();
    const order: string[] = [];

    clock.schedule(8, () => order.push("eight"));
    clock.schedule(3, () => order.push("three"));

    clock.advanceTo(10);

    expect(order).toEqual(["three", "eight"]);
  });

  it("fires a callback scheduled exactly at the target UT (inclusive)", () => {
    const clock = new ManualClock();
    let fired = false;

    clock.schedule(5, () => {
      fired = true;
    });

    clock.advanceTo(5);

    expect(fired).toBe(true);
  });

  it("returns a cancel handle that removes a pending callback", () => {
    const clock = new ManualClock();
    let fired = false;

    const cancel = clock.schedule(10, () => {
      fired = true;
    });
    cancel();

    clock.advanceTo(10);

    expect(fired).toBe(false);
  });

  it("does not rewind or fire anything when advancing backward", () => {
    const clock = new ManualClock(10);
    let fired = false;

    clock.schedule(5, () => {
      fired = true;
    });

    clock.advanceTo(3);

    expect(clock.now()).toBe(10);
    expect(fired).toBe(false);
  });

  it("does not fire callbacks scheduled after the target UT", () => {
    const clock = new ManualClock();
    let fired = false;

    clock.schedule(20, () => {
      fired = true;
    });

    clock.advanceTo(10);

    expect(fired).toBe(false);
    expect(clock.now()).toBe(10);
  });

  it("drains a same-UT reschedule made from inside a firing callback", () => {
    const clock = new ManualClock();
    let fn2Called = false;

    clock.schedule(5, () => {
      clock.schedule(5, () => {
        fn2Called = true;
      });
    });

    clock.advanceTo(5);

    expect(fn2Called).toBe(true);
  });

  it("drains a re-entrant schedule at a future (still-due) UT, in ascending order", () => {
    const clock = new ManualClock();
    const order: string[] = [];

    clock.schedule(3, () => {
      order.push("three");
      clock.schedule(8, () => {
        order.push("eight");
      });
    });

    clock.advanceTo(10);

    expect(order).toEqual(["three", "eight"]);
  });

  it("still processes a callback scheduled at the current UT on a repeat advanceTo to the same UT", () => {
    const clock = new ManualClock();

    clock.advanceTo(5);

    let fired = false;
    clock.schedule(5, () => {
      fired = true;
    });

    clock.advanceTo(5);

    expect(fired).toBe(true);
  });
});
