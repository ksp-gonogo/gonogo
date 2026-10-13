import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrimCoalescer, TRIM_COALESCE_MS } from "./trimCoalescer";

describe("createTrimCoalescer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a sweep at ten a second, ending on the value the stick rests at", () => {
    const send = vi.fn();
    const trim = createTrimCoalescer(send);
    // 60 events a second for one second, as a gamepad emits them.
    for (let i = 0; i < 60; i++) {
      trim.push("pitchTrim", i / 100);
      vi.advanceTimersByTime(1000 / 60);
    }
    vi.advanceTimersByTime(TRIM_COALESCE_MS);
    expect(send.mock.calls.length).toBeLessThanOrEqual(12);
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(9);
    expect(send).toHaveBeenLastCalledWith("pitchTrim", 0.59);
  });

  it("sends the first event at once", () => {
    const send = vi.fn();
    createTrimCoalescer(send).push("rollTrim", 0.3);
    expect(send).toHaveBeenCalledWith("rollTrim", 0.3);
  });

  it("keeps each field to its own window", () => {
    const send = vi.fn();
    const trim = createTrimCoalescer(send);
    trim.push("pitchTrim", 0.1);
    trim.push("yawTrim", 0.2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("drops what is waiting when cancelled", () => {
    const send = vi.fn();
    const trim = createTrimCoalescer(send);
    trim.push("pitchTrim", 0.1);
    trim.push("pitchTrim", 0.2);
    trim.cancel();
    vi.advanceTimersByTime(TRIM_COALESCE_MS * 2);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
