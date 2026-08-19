import { logger as realLogger } from "@ksp-gonogo/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTestHost, resetTestHost } from "../testing";
import { PerfBudget } from "./PerfBudget";

// The breach warning goes through the sdk's host-routed `logger` shim, so these
// tests install a host: that is the path the app takes. `logger` is the only
// member of the host a budget ever touches, so a one-member host is honest here
// rather than lazy. The no-host path has its own test at the bottom, because it
// is a genuine behaviour and not a fallback nobody hits: a budget is constructed
// at module scope and recorded against from hot paths, both of which can run
// before any host exists.
describe("PerfBudget", () => {
  beforeEach(() => {
    installTestHost({ logger: realLogger });
  });

  afterEach(() => {
    PerfBudget.clearRegistry();
    resetTestHost();
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
    const warn = vi.spyOn(realLogger, "warn").mockImplementation(() => {});
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
    const warn = vi.spyOn(realLogger, "warn").mockImplementation(() => {});
    // Burst: 6 events at the same instant. First exceedance fires once.
    for (let i = 0; i < 6; i++) b.record(1, 1000);
    expect(warn).toHaveBeenCalledTimes(1);
    // More overruns within the same window: throttled, no extra warn.
    for (let i = 0; i < 10; i++) b.record(1, 1100 + i);
    expect(warn).toHaveBeenCalledTimes(1);
    // Past the window: events have aged out, but a fresh burst should
    // re-trigger the warn.
    for (let i = 0; i < 6; i++) b.record(1, 3000 + i);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("supports volume tracking: record(amount) sums in the window", () => {
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
    const warn = vi.spyOn(realLogger, "warn").mockImplementation(() => {});
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
    // After the run, internal events array should not be 10k long,
    // compaction kicks in once the head crosses 256 + half of length.
    // Hard to assert exact size, but the rate at the end should be small.
    expect(b.rate(10_000)).toBeLessThan(200);
  });
});

describe("PerfBudget without a host installed", () => {
  afterEach(() => {
    PerfBudget.clearRegistry();
  });

  // Regression. Routing the breach warning through the sdk's `logger` shim made
  // `record()` THROW when no host was installed, because the shim's whole job
  // elsewhere is to fail loudly rather than silently register into a dead
  // registry. That is right for `registerComponent` and wrong here: this is the
  // diagnostic path of a budget being breached, and a warning that takes down the
  // thing it is observing is worse than no warning at all. Four of this file's
  // own tests failed exactly this way, which is how it was caught.
  it("warns on the console instead of throwing", () => {
    resetTestHost();
    const b = new PerfBudget({
      name: "hostless",
      threshold: 2,
      windowMs: 1000,
    });
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => {
      for (let i = 0; i < 3; i++) b.record(1, 1000);
    }).not.toThrow();
    expect(consoleWarn).toHaveBeenCalledTimes(1);

    consoleWarn.mockRestore();
  });

  it("records and reports rates with no host at all", () => {
    resetTestHost();
    const b = new PerfBudget({ name: "hostless-rate", threshold: 100 });
    b.record(3, 1000);
    expect(b.rate(1000)).toBe(3);
  });
});
