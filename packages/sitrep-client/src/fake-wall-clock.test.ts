import { describe, expect, it } from "vitest";
import { createFakeWallClock } from "./fake-wall-clock";

describe("createFakeWallClock", () => {
  it("starts at the given value (default 0) and only moves via advanceBy", () => {
    const wall = createFakeWallClock();
    expect(wall.now()).toBe(0);

    const started = createFakeWallClock(10);
    expect(started.now()).toBe(10);
  });

  it("advances by the given number of seconds", () => {
    const wall = createFakeWallClock(0);
    wall.advanceBy(5);
    expect(wall.now()).toBe(5);
    wall.advanceBy(2.5);
    expect(wall.now()).toBe(7.5);
  });

  it("ignores a non-positive advance", () => {
    const wall = createFakeWallClock(10);
    wall.advanceBy(0);
    wall.advanceBy(-5);
    expect(wall.now()).toBe(10);
  });
});
