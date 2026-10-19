import { describe, expect, it } from "vitest";
import { createLogRateLimiter } from "../logRateLimit.js";

describe("createLogRateLimiter", () => {
  it("passes the first lines of a group, then drops and counts the rest", () => {
    const l = createLogRateLimiter(3, 1000);
    const passed = Array.from({ length: 10 }, () =>
      l.allow("bind: Address already in use", 0),
    ).filter(Boolean);
    expect(passed).toHaveLength(3);
    expect(l.flush()).toEqual([
      "suppressed 7 repeats of: bind: Address already in use",
    ]);
  });

  it("groups lines that differ only in their numbers", () => {
    const l = createLogRateLimiter(1, 1000);
    expect(l.allow("Trying to bind fd 10", 0)).toBe(true);
    expect(l.allow("Trying to bind fd 11", 0)).toBe(false);
  });

  it("keeps different lines apart", () => {
    const l = createLogRateLimiter(1, 1000);
    expect(l.allow("one", 0)).toBe(true);
    expect(l.allow("two", 0)).toBe(true);
  });

  it("lets a group through again in the next window", () => {
    const l = createLogRateLimiter(1, 1000);
    expect(l.allow("x", 0)).toBe(true);
    expect(l.allow("x", 500)).toBe(false);
    expect(l.allow("x", 1000)).toBe(true);
  });

  it("reports nothing when nothing was dropped", () => {
    const l = createLogRateLimiter(5, 1000);
    l.allow("x", 0);
    expect(l.flush()).toEqual([]);
  });
});
