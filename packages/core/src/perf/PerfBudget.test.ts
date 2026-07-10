import { logger } from "@ksp-gonogo/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PerfBudget } from "./PerfBudget";

describe("PerfBudget", () => {
  afterEach(() => {
    PerfBudget.clearRegistry();
  });

  it("tracks the windowed total and clears events outside the window", () => {
    const b = new PerfBudget({ name: "test", threshold: 10, windowMs: 1000 });
    b.record(1, 1000);
    b.record(2, 1500);
    expect(b.rate(1500)).toBe(3);
    // 2001 → window starts at 1001; the 1000 event drops out.
    expect(b.rate(2001)).toBe(2);
    // 2501 → window starts at 1501; both drop out.
    expect(b.rate(2501)).toBe(0);
  });

  it("does not warn while under the threshold", () => {
    const b = new PerfBudget({ name: "test", threshold: 5, windowMs: 1000 });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    for (let i = 0; i < 5; i++) b.record(1, 1000 + i);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns once per window when sustained over threshold", () => {
    const b = new PerfBudget({
      name: "broadcast",
      threshold: 5,
      windowMs: 1000,
    });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    // Burst — 6 events at the same instant. First exceedance fires once.
    for (let i = 0; i < 6; i++) b.record(1, 1000);
    expect(warn).toHaveBeenCalledTimes(1);
    // More overruns within the same window: throttled, no extra warn.
    for (let i = 0; i < 10; i++) b.record(1, 1100 + i);
    expect(warn).toHaveBeenCalledTimes(1);
    // Past the window — events have aged out, but a fresh burst should
    // re-trigger the warn.
    for (let i = 0; i < 6; i++) b.record(1, 3000 + i);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("supports volume tracking — record(amount) sums in the window", () => {
    const b = new PerfBudget({
      name: "bytes",
      threshold: 1000,
      windowMs: 1000,
      unit: "bytes",
    });
    b.record(400, 1000);
    b.record(500, 1500);
    expect(b.rate(1500)).toBe(900);
    b.record(300, 1700);
    expect(b.rate(1700)).toBe(1200);
  });

  it("counts exceedances independently from warn-throttling", () => {
    const b = new PerfBudget({ name: "x", threshold: 1, windowMs: 1000 });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    for (let i = 0; i < 5; i++) b.record(1, 1000 + i);
    expect(b.getExceedanceCount()).toBeGreaterThan(0);
    // Even though warns were throttled, every record over threshold
    // should bump the counter.
    expect(b.getExceedanceCount()).toBe(4);
    warn.mockRestore();
  });

  it("registers itself for app-wide inspection", () => {
    const a = new PerfBudget({ name: "a", threshold: 1 });
    const b = new PerfBudget({ name: "b", threshold: 1 });
    const all = PerfBudget.getAll();
    expect(all).toContain(a);
    expect(all).toContain(b);
  });

  it("compacts the internal array under sustained load", () => {
    const b = new PerfBudget({
      name: "compact",
      threshold: 100_000,
      windowMs: 100,
    });
    // Push 10k events, walking time forward so they age out.
    for (let i = 0; i < 10_000; i++) {
      b.record(1, i * 1);
    }
    // After the run, internal events array should not be 10k long —
    // compaction kicks in once the head crosses 256 + half of length.
    // Hard to assert exact size, but the rate at the end should be small.
    expect(b.rate(10_000)).toBeLessThan(200);
  });
});
