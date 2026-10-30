import { describe, expect, it } from "vitest";
import { localDeadline, secondsUntil } from "./countdownClock";

describe("countdownClock", () => {
  it("derives the deadline from the remaining time on the local clock", () => {
    expect(localDeadline(10_000, 5_000)).toBe(15_000);
  });

  it("counts down to zero and never below", () => {
    expect(secondsUntil(15_000, 8_000)).toBe(7);
    expect(secondsUntil(15_000, 20_000)).toBe(0);
  });
});
