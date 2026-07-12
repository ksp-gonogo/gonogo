import "fake-indexeddb/auto";
import { SCAN_TYPE } from "@ksp-gonogo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FogMaskCache } from "./FogMaskCache";
import { FogMaskStore } from "./FogMaskStore";

const HI = SCAN_TYPE.AltimetryHiRes;
const LO = SCAN_TYPE.AltimetryLoRes;

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
    const mask = await cache.acquire("Kerbin", HI);
    expect(mask.scanType).toBe(HI);
    expect(mask.data).toHaveLength(8);
    expect(Array.from(mask.data)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("returns the same mask instance on repeat acquire for one (body, scanType)", async () => {
    const { cache } = makeCache();
    const m1 = await cache.acquire("Kerbin", HI);
    const m2 = await cache.acquire("Kerbin", HI);
    expect(m1).toBe(m2);
  });

  it("returns independent masks for different scan types on the same body", async () => {
    const { cache } = makeCache();
    const hi = await cache.acquire("Kerbin", HI);
    const lo = await cache.acquire("Kerbin", LO);
    expect(hi).not.toBe(lo);
    expect(hi.scanType).toBe(HI);
    expect(lo.scanType).toBe(LO);
    // Mutating one type's mask must not leak into the other.
    hi.data[0] = 200;
    expect(lo.data[0]).toBe(0);
  });

  it("dedupes concurrent acquires for the same (body, scanType)", async () => {
    const { cache } = makeCache();
    const [m1, m2] = await Promise.all([
      cache.acquire("Kerbin", HI),
      cache.acquire("Kerbin", HI),
    ]);
    expect(m1).toBe(m2);
  });

  it("persists dirty masks on flush and reloads them on a new cache", async () => {
    const { store, cache } = makeCache();
    const mask = await cache.acquire("Kerbin", HI);
    mask.data[0] = 200;
    mask.data[7] = 255;
    cache.markDirty("Kerbin", HI);
    await cache.flush();

    const cache2 = new FogMaskCache(store, "profile-1", {
      width: 4,
      height: 2,
      flushDebounceMs: 10,
    });
    const reloaded = await cache2.acquire("Kerbin", HI);
    expect(Array.from(reloaded.data)).toEqual([200, 0, 0, 0, 0, 0, 0, 255]);
  });

  // Regression: in the real useBodyFogMask hook, onChange (which creates a
  // stub shell entry to accept subscribers) runs *before* acquire. A naïve
  // acquire would return that zeroed shell and skip the IDB read entirely.
  it("reloads from IDB even when a subscriber has already registered", async () => {
    const { store, cache } = makeCache();
    const mask = await cache.acquire("Kerbin", HI);
    mask.data[0] = 77;
    cache.markDirty("Kerbin", HI);
    await cache.flush();

    const cache2 = new FogMaskCache(store, "profile-1", {
      width: 4,
      height: 2,
      flushDebounceMs: 10,
    });
    cache2.onChange("Kerbin", HI, () => {}); // creates the stub shell
    const reloaded = await cache2.acquire("Kerbin", HI);
    expect(reloaded.data[0]).toBe(77);
  });

  it("notifies subscribers on markDirty for the matching scanType only", async () => {
    const { cache } = makeCache();
    const hi = await cache.acquire("Kerbin", HI);
    await cache.acquire("Kerbin", LO);
    const hiSpy = vi.fn();
    const loSpy = vi.fn();
    cache.onChange("Kerbin", HI, hiSpy);
    cache.onChange("Kerbin", LO, loSpy);
    cache.markDirty("Kerbin", HI);
    expect(hiSpy).toHaveBeenCalledWith(hi);
    expect(loSpy).not.toHaveBeenCalled();
  });

  it("clear wipes in-memory bytes and the IDB record for one (body, scanType)", async () => {
    const { store, cache } = makeCache();
    const hi = await cache.acquire("Kerbin", HI);
    const lo = await cache.acquire("Kerbin", LO);
    hi.data[0] = 99;
    lo.data[0] = 77;
    cache.markDirty("Kerbin", HI);
    cache.markDirty("Kerbin", LO);
    await cache.flush();
    await cache.clear("Kerbin", HI);
    expect(hi.data[0]).toBe(0);
    expect(lo.data[0]).toBe(77); // LO untouched
    expect(await store.load("profile-1", "Kerbin", HI)).toBeNull();
    expect(await store.load("profile-1", "Kerbin", LO)).not.toBeNull();
  });

  it("treats a mismatched-dimension stored mask as absent", async () => {
    const { store } = makeCache();
    // Write a mask with different dimensions directly to the store.
    await store.save(
      "profile-1",
      "Kerbin",
      HI,
      new Uint8Array([1, 2, 3, 4]),
      2,
      2,
    );
    // Now create a cache expecting 4×2.
    const cache = new FogMaskCache(store, "profile-1", {
      width: 4,
      height: 2,
      flushDebounceMs: 10,
    });
    const mask = await cache.acquire("Kerbin", HI);
    expect(Array.from(mask.data)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("reloads in-memory bytes and notifies subscribers when the store changes externally (snapshot path)", async () => {
    const { store, cache } = makeCache();
    // Subscribe BEFORE the external write so we observe the notify.
    const mask = await cache.acquire("Kerbin", HI);
    const spy = vi.fn();
    cache.onChange("Kerbin", HI, spy);
    expect(mask.data[0]).toBe(0);

    // External write — bypasses the cache entirely (this models a fog
    // snapshot landing on a station).
    await store.save(
      "profile-1",
      "Kerbin",
      HI,
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
    const mask = await cache.acquire("Kerbin", HI);
    mask.data[0] = 42;
    cache.markDirty("Kerbin", HI);
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
