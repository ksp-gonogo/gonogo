import { PerfBudget } from "@ksp-gonogo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsService } from "./SettingsService";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    length: 0,
    clear: () => map.clear(),
    key: () => null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  } as Storage;
}

describe("SettingsService", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("returns the fallback when a key is unset", () => {
    const svc = new SettingsService(storage);
    expect(svc.get("whatever", true)).toBe(true);
    expect(svc.get("numeric", 42)).toBe(42);
  });

  it("persists across instances through the provided storage", () => {
    const a = new SettingsService(storage);
    a.set("flag", false);
    // Writes are debounced — flush before constructing the second
    // instance so it sees the persisted value.
    a.flush();
    const b = new SettingsService(storage);
    expect(b.get("flag", true)).toBe(false);
  });

  it("fires per-key subscribers on change", () => {
    const svc = new SettingsService(storage);
    const cb = vi.fn();
    const unsub = svc.subscribe<boolean>("flag", cb);
    svc.set("flag", true);
    expect(cb).toHaveBeenCalledWith(true);
    unsub();
    svc.set("flag", false);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("deduplicates identical writes", () => {
    const svc = new SettingsService(storage);
    const cb = vi.fn();
    svc.subscribe<boolean>("flag", cb);
    svc.set("flag", true);
    svc.set("flag", true);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("survives corrupt storage by clearing and starting fresh", () => {
    storage.setItem("gonogo.settings", "{not json");
    const svc = new SettingsService(storage);
    expect(svc.get("flag", true)).toBe(true);
    // Writing something proves the service is usable.
    svc.set("flag", false);
    expect(svc.get("flag", true)).toBe(false);
  });

  it("coalesces a burst of writes into a single localStorage call", () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(storage, "setItem");
    const svc = new SettingsService(storage);
    setItem.mockClear();
    svc.set("a", 1);
    svc.set("b", 2);
    svc.set("c", 3);
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(setItem).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("records every save to the SettingsService perf budget", () => {
    // Find the module-registered budget by name. It's created when the
    // SettingsService module is imported, so it always exists by this
    // point.
    const budget = PerfBudget.getAll().find((b) =>
      b.name.startsWith("SettingsService.save"),
    );
    expect(budget).toBeDefined();
    if (!budget) return;
    const before = budget.rate();
    const svc = new SettingsService(storage);
    svc.set("flag", true);
    svc.flush();
    svc.set("flag", false);
    svc.flush();
    expect(budget.rate()).toBe(before + 2);
  });
});
