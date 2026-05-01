import { logger } from "@gonogo/core";
import { memoryStorage } from "@gonogo/core/test";
import { describe, expect, it, vi } from "vitest";
import { LocalStorageStore } from "./LocalStorageStore";

interface Cfg {
  host: string;
  port: number;
  enabled?: boolean;
}

const DEFAULTS: Cfg = { host: "localhost", port: 8085 };

describe("LocalStorageStore", () => {
  it("returns defaults when the key is missing", () => {
    const store = new LocalStorageStore<Cfg>({
      key: "k",
      defaults: DEFAULTS,
      storage: memoryStorage(),
    });
    expect(store.get()).toEqual(DEFAULTS);
  });

  it("returns a fresh defaults object each call (no shared reference)", () => {
    const store = new LocalStorageStore<Cfg>({
      key: "k",
      defaults: DEFAULTS,
      storage: memoryStorage(),
    });
    const a = store.get();
    const b = store.get();
    expect(a).not.toBe(b);
    expect(a).not.toBe(DEFAULTS);
  });

  it("returns defaults and fires onCorruption when JSON is malformed", () => {
    const storage = memoryStorage();
    storage.setItem("k", "{not json");
    const onCorruption = vi.fn();
    const store = new LocalStorageStore<Cfg>({
      key: "k",
      defaults: DEFAULTS,
      storage,
      onCorruption,
    });
    expect(store.get()).toEqual(DEFAULTS);
    expect(onCorruption).toHaveBeenCalledTimes(1);
    expect(onCorruption.mock.calls[0][0]).toBe("{not json");
    expect(onCorruption.mock.calls[0][1]).toBeInstanceOf(Error);
  });

  it("logs corruption via the central logger when no callback is provided", () => {
    const storage = memoryStorage();
    storage.setItem("the-key", "{also not json");
    const warn = vi.fn();
    const tagSpy = vi.spyOn(logger, "tag").mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    });
    const store = new LocalStorageStore<Cfg>({
      key: "the-key",
      defaults: DEFAULTS,
      storage,
    });
    expect(store.get()).toEqual(DEFAULTS);
    expect(tagSpy).toHaveBeenCalledWith("storage");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("the-key");
    tagSpy.mockRestore();
  });

  it("round-trips set → get", () => {
    const store = new LocalStorageStore<Cfg>({
      key: "k",
      defaults: DEFAULTS,
      storage: memoryStorage(),
    });
    store.set({ host: "kerbin.local", port: 9000 });
    expect(store.get()).toEqual({ host: "kerbin.local", port: 9000 });
  });

  it("merges partial stored value over defaults (adds missing fields)", () => {
    const storage = memoryStorage();
    storage.setItem("k", JSON.stringify({ host: "remote" }));
    const store = new LocalStorageStore<Cfg>({
      key: "k",
      defaults: DEFAULTS,
      storage,
    });
    expect(store.get()).toEqual({ host: "remote", port: 8085 });
  });

  it("patch merges partial into stored value", () => {
    const store = new LocalStorageStore<Cfg>({
      key: "k",
      defaults: DEFAULTS,
      storage: memoryStorage(),
    });
    store.set({ host: "a", port: 1 });
    store.patch({ port: 2 });
    expect(store.get()).toEqual({ host: "a", port: 2 });
  });

  it("patch from defaults writes the merged value", () => {
    const store = new LocalStorageStore<Cfg>({
      key: "k",
      defaults: DEFAULTS,
      storage: memoryStorage(),
    });
    store.patch({ enabled: true });
    expect(store.get()).toEqual({
      host: "localhost",
      port: 8085,
      enabled: true,
    });
  });

  it("clear removes the key and subsequent get returns defaults", () => {
    const storage = memoryStorage();
    const store = new LocalStorageStore<Cfg>({
      key: "k",
      defaults: DEFAULTS,
      storage,
    });
    store.set({ host: "x", port: 1 });
    store.clear();
    expect(storage.getItem("k")).toBeNull();
    expect(store.get()).toEqual(DEFAULTS);
  });

  it("subscribe receives writes from set", () => {
    const store = new LocalStorageStore<Cfg>({
      key: "k",
      defaults: DEFAULTS,
      storage: memoryStorage(),
    });
    const cb = vi.fn();
    store.subscribe(cb);
    store.set({ host: "h", port: 2 });
    expect(cb).toHaveBeenCalledWith({ host: "h", port: 2 });
  });

  it("subscribe receives writes from patch", () => {
    const store = new LocalStorageStore<Cfg>({
      key: "k",
      defaults: DEFAULTS,
      storage: memoryStorage(),
    });
    const cb = vi.fn();
    store.subscribe(cb);
    store.patch({ port: 9 });
    expect(cb).toHaveBeenCalledWith({ host: "localhost", port: 9 });
  });

  it("subscribe receives defaults from clear", () => {
    const store = new LocalStorageStore<Cfg>({
      key: "k",
      defaults: DEFAULTS,
      storage: memoryStorage(),
    });
    store.set({ host: "h", port: 2 });
    const cb = vi.fn();
    store.subscribe(cb);
    store.clear();
    expect(cb).toHaveBeenCalledWith(DEFAULTS);
  });

  it("unsubscribe stops further notifications", () => {
    const store = new LocalStorageStore<Cfg>({
      key: "k",
      defaults: DEFAULTS,
      storage: memoryStorage(),
    });
    const cb = vi.fn();
    const off = store.subscribe(cb);
    store.set({ host: "h", port: 1 });
    off();
    store.set({ host: "h", port: 2 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("set fires subscribers only after a successful write", () => {
    const cb = vi.fn();
    const throwing: Storage = {
      length: 0,
      clear: () => {},
      key: () => null,
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    const store = new LocalStorageStore<Cfg>({
      key: "k",
      defaults: DEFAULTS,
      storage: throwing,
    });
    store.subscribe(cb);
    expect(() => {
      store.set({ host: "h", port: 1 });
    }).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("get returns defaults when storage.getItem throws", () => {
    const throwing: Storage = {
      length: 0,
      clear: () => {},
      key: () => null,
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    const store = new LocalStorageStore<Cfg>({
      key: "k",
      defaults: DEFAULTS,
      storage: throwing,
    });
    expect(store.get()).toEqual(DEFAULTS);
  });

  it("clear swallows storage.removeItem errors and skips subscriber notify", () => {
    const cb = vi.fn();
    const throwing: Storage = {
      length: 0,
      clear: () => {},
      key: () => null,
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error("denied");
      },
    };
    const store = new LocalStorageStore<Cfg>({
      key: "k",
      defaults: DEFAULTS,
      storage: throwing,
    });
    store.subscribe(cb);
    expect(() => {
      store.clear();
    }).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("supports primitive T (string)", () => {
    const store = new LocalStorageStore<string>({
      key: "k",
      defaults: "default",
      storage: memoryStorage(),
    });
    store.set("hello");
    expect(store.get()).toBe("hello");
  });

  it("supports array T without spread-merging into defaults", () => {
    const storage = memoryStorage();
    storage.setItem("k", JSON.stringify([1, 2]));
    const store = new LocalStorageStore<number[]>({
      key: "k",
      defaults: [9],
      storage,
    });
    expect(store.get()).toEqual([1, 2]);
  });
});
