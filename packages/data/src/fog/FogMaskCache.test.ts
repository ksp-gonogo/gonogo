import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FogMaskCache } from "./FogMaskCache";
import { FogMaskStore } from "./FogMaskStore";

function makeCache(opts?: { flushDebounceMs?: number }) {
  const store = new FogMaskStore({
    dbName: `gonogo-fog-test-${Math.random()}`,
  });
  const cache = new FogMaskCache(store, "profile-1", {
    width: 4,
    height: 2,
    flushDebounceMs: opts?.flushDebounceMs ?? 10,
  });
  return { store, cache };
}

describe("FogMaskCache", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("allocates a zeroed mask on first acquire", async () => {
    const { cache } = makeCache();
    const mask = await cache.acquire("Kerbin");
    expect(mask.data).toHaveLength(8);
    expect(Array.from(mask.data)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("returns the same mask instance on repeat acquire", async () => {
    const { cache } = makeCache();
    const m1 = await cache.acquire("Kerbin");
    const m2 = await cache.acquire("Kerbin");
    expect(m1).toBe(m2);
  });

  it("dedupes concurrent acquires", async () => {
    const { cache } = makeCache();
    const [m1, m2] = await Promise.all([
      cache.acquire("Kerbin"),
      cache.acquire("Kerbin"),
    ]);
    expect(m1).toBe(m2);
  });

  it("persists dirty masks on flush and reloads them on a new cache", async () => {
    const { store, cache } = makeCache();
    const mask = await cache.acquire("Kerbin");
    mask.data[0] = 200;
    mask.data[7] = 255;
    cache.markDirty("Kerbin");
    await cache.flush();

    const cache2 = new FogMaskCache(store, "profile-1", {
      width: 4,
      height: 2,
      flushDebounceMs: 10,
    });
    const reloaded = await cache2.acquire("Kerbin");
    expect(Array.from(reloaded.data)).toEqual([200, 0, 0, 0, 0, 0, 0, 255]);
  });

  // Regression: in the real useBodyFogMask hook, onChange (which creates a
  // stub shell entry to accept subscribers) runs *before* acquire. A naïve
  // acquire would return that zeroed shell and skip the IDB read entirely.
  it("reloads from IDB even when a subscriber has already registered", async () => {
    const { store, cache } = makeCache();
    const mask = await cache.acquire("Kerbin");
    mask.data[0] = 77;
    cache.markDirty("Kerbin");
    await cache.flush();

    const cache2 = new FogMaskCache(store, "profile-1", {
      width: 4,
      height: 2,
      flushDebounceMs: 10,
    });
    cache2.onChange("Kerbin", () => {}); // creates the stub shell
    const reloaded = await cache2.acquire("Kerbin");
    expect(reloaded.data[0]).toBe(77);
  });

  it("notifies subscribers on markDirty", async () => {
    const { cache } = makeCache();
    const mask = await cache.acquire("Kerbin");
    const spy = vi.fn();
    cache.onChange("Kerbin", spy);
    cache.markDirty("Kerbin");
    expect(spy).toHaveBeenCalledWith(mask);
  });

  it("clear wipes in-memory bytes and the IDB record", async () => {
    const { store, cache } = makeCache();
    const mask = await cache.acquire("Kerbin");
    mask.data[0] = 99;
    cache.markDirty("Kerbin");
    await cache.flush();
    await cache.clear("Kerbin");
    expect(mask.data[0]).toBe(0);
    expect(await store.load("profile-1", "Kerbin")).toBeNull();
  });

  it("treats a mismatched-dimension stored mask as absent", async () => {
    const { store } = makeCache();
    // Write a mask with different dimensions directly to the store.
    await store.save("profile-1", "Kerbin", new Uint8Array([1, 2, 3, 4]), 2, 2);
    // Now create a cache expecting 4×2.
    const cache = new FogMaskCache(store, "profile-1", {
      width: 4,
      height: 2,
      flushDebounceMs: 10,
    });
    const mask = await cache.acquire("Kerbin");
    expect(Array.from(mask.data)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("reloads in-memory bytes and notifies subscribers when the store changes externally (snapshot path)", async () => {
    const { store, cache } = makeCache();
    // Subscribe BEFORE the external write so we observe the notify.
    const mask = await cache.acquire("Kerbin");
    const spy = vi.fn();
    cache.onChange("Kerbin", spy);
    expect(mask.data[0]).toBe(0);

    // External write — bypasses the cache entirely (this models a fog
    // snapshot landing on a station).
    await store.save(
      "profile-1",
      "Kerbin",
      new Uint8Array([7, 8, 9, 10, 11, 12, 13, 14]),
      4,
      2,
    );

    // Listener fires; the cache's mask buffer reflects the new bytes
    // (preserving the original reference so canvas paint loops survive).
    await vi.waitFor(() => {
      expect(mask.data[0]).toBe(7);
    });
    expect(Array.from(mask.data)).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
    expect(spy).toHaveBeenCalled();
  });

  it("ignores own-writes via the origin tag (no race-reload over a fresh local mutation)", async () => {
    const { cache } = makeCache();
    const mask = await cache.acquire("Kerbin");
    mask.data[0] = 42;
    cache.markDirty("Kerbin");
    await cache.flush();
    // After flush, the cache's own save fired the change listener with
    // the cache's origin tag — the listener must short-circuit, leaving
    // any local mutation that happened *between* flush starting and
    // resolving in place.
    mask.data[1] = 99;
    // Give a microtask cycle for any stray reload to run.
    await Promise.resolve();
    expect(mask.data[0]).toBe(42);
    expect(mask.data[1]).toBe(99);
  });
});
