import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { FogMaskStore } from "./FogMaskStore";

function freshStore(): FogMaskStore {
  // Unique DB name per test so state never leaks between cases
  return new FogMaskStore({ dbName: `gonogo-fog-test-${Math.random()}` });
}

const HI = "altimetry-hi";
const LO = "altimetry-lo";
const BIOME = "biome";

describe("FogMaskStore", () => {
  let store: FogMaskStore;

  beforeEach(() => {
    store = freshStore();
  });

  it("returns null for an un-saved mask", async () => {
    const result = await store.load("profile-1", "Kerbin", HI);
    expect(result).toBeNull();
  });

  it("round-trips a mask", async () => {
    const data = new Uint8Array([10, 20, 30, 40]);
    await store.save("profile-1", "Kerbin", HI, data, 2, 2);
    const loaded = await store.load("profile-1", "Kerbin", HI);
    expect(loaded).not.toBeNull();
    expect(loaded?.layerId).toBe(HI);
    expect(loaded?.width).toBe(2);
    expect(loaded?.height).toBe(2);
    expect(Array.from(loaded?.data ?? [])).toEqual([10, 20, 30, 40]);
  });

  it("isolates masks by layerId so AltLoRes and AltHiRes coexist", async () => {
    await store.save("p", "Kerbin", LO, new Uint8Array([1]), 1, 1);
    await store.save("p", "Kerbin", HI, new Uint8Array([2]), 1, 1);
    expect((await store.load("p", "Kerbin", LO))?.data[0]).toBe(1);
    expect((await store.load("p", "Kerbin", HI))?.data[0]).toBe(2);
  });

  it("overwrites on re-save for the same (profile, body, layerId)", async () => {
    await store.save("p", "Kerbin", HI, new Uint8Array([1]), 1, 1);
    await store.save("p", "Kerbin", HI, new Uint8Array([2]), 1, 1);
    const loaded = await store.load("p", "Kerbin", HI);
    expect(Array.from(loaded?.data ?? [])).toEqual([2]);
  });

  it("isolates different profiles, bodies, and scan types", async () => {
    await store.save("p1", "Kerbin", HI, new Uint8Array([1]), 1, 1);
    await store.save("p2", "Kerbin", HI, new Uint8Array([2]), 1, 1);
    await store.save("p1", "Mun", HI, new Uint8Array([3]), 1, 1);
    await store.save("p1", "Kerbin", LO, new Uint8Array([4]), 1, 1);
    expect((await store.load("p1", "Kerbin", HI))?.data[0]).toBe(1);
    expect((await store.load("p2", "Kerbin", HI))?.data[0]).toBe(2);
    expect((await store.load("p1", "Mun", HI))?.data[0]).toBe(3);
    expect((await store.load("p1", "Kerbin", LO))?.data[0]).toBe(4);
  });

  it("clear removes only the specified (profile, body, layerId)", async () => {
    await store.save("p", "Kerbin", HI, new Uint8Array([1]), 1, 1);
    await store.save("p", "Kerbin", LO, new Uint8Array([2]), 1, 1);
    await store.save("p", "Mun", HI, new Uint8Array([3]), 1, 1);
    await store.clear("p", "Kerbin", HI);
    expect(await store.load("p", "Kerbin", HI)).toBeNull();
    expect(await store.load("p", "Kerbin", LO)).not.toBeNull();
    expect(await store.load("p", "Mun", HI)).not.toBeNull();
  });

  it("clearBody removes every layerId for a body but leaves other bodies alone", async () => {
    await store.save("p", "Kerbin", HI, new Uint8Array([1]), 1, 1);
    await store.save("p", "Kerbin", LO, new Uint8Array([2]), 1, 1);
    await store.save("p", "Kerbin", BIOME, new Uint8Array([3]), 1, 1);
    await store.save("p", "Mun", HI, new Uint8Array([9]), 1, 1);
    await store.clearBody("p", "Kerbin");
    expect(await store.load("p", "Kerbin", HI)).toBeNull();
    expect(await store.load("p", "Kerbin", LO)).toBeNull();
    expect(await store.load("p", "Kerbin", BIOME)).toBeNull();
    expect(await store.load("p", "Mun", HI)).not.toBeNull();
  });

  it("clearProfile removes every body and every scan type for a profile", async () => {
    await store.save("p1", "Kerbin", HI, new Uint8Array([1]), 1, 1);
    await store.save("p1", "Kerbin", LO, new Uint8Array([2]), 1, 1);
    await store.save("p1", "Mun", HI, new Uint8Array([3]), 1, 1);
    await store.save("p2", "Kerbin", HI, new Uint8Array([9]), 1, 1);
    await store.clearProfile("p1");
    expect(await store.load("p1", "Kerbin", HI)).toBeNull();
    expect(await store.load("p1", "Kerbin", LO)).toBeNull();
    expect(await store.load("p1", "Mun", HI)).toBeNull();
    expect(await store.load("p2", "Kerbin", HI)).not.toBeNull();
  });

  it("loadAllForProfile returns every per-type mask for a profile and only that profile", async () => {
    await store.save("p1", "Kerbin", HI, new Uint8Array([1, 2]), 2, 1);
    await store.save("p1", "Kerbin", LO, new Uint8Array([3, 4]), 2, 1);
    await store.save("p1", "Mun", BIOME, new Uint8Array([5, 6]), 2, 1);
    // Different profile — must NOT be returned.
    await store.save("p2", "Kerbin", HI, new Uint8Array([9]), 1, 1);

    const masks = await store.loadAllForProfile("p1");
    expect(masks).toHaveLength(3);
    // Each row carries its layerId — used by FogSyncHostService to route
    // station-bound payloads to the right per-type slot.
    const byKey = new Map(
      masks.map((m) => [
        `${m.key.split(":")[1]}:${m.layerId}`,
        Array.from(m.data),
      ]),
    );
    expect(byKey.get(`Kerbin:${HI}`)).toEqual([1, 2]);
    expect(byKey.get(`Kerbin:${LO}`)).toEqual([3, 4]);
    expect(byKey.get(`Mun:${BIOME}`)).toEqual([5, 6]);
  });

  it("loadAllForProfile returns an empty array for a profile with no masks", async () => {
    expect(await store.loadAllForProfile("never-saved")).toEqual([]);
  });

  it("loadAllForProfile doesn't bleed across prefix-similar profile ids", async () => {
    // Bug class: a profile id that's a prefix of another (e.g. "p1" vs
    // "p1-extra") could be over-greedy if the cursor range bound is
    // mis-set. Lock the boundary down with an explicit case.
    await store.save("p1", "Kerbin", HI, new Uint8Array([1]), 1, 1);
    await store.save("p1-extra", "Kerbin", HI, new Uint8Array([2]), 1, 1);

    const masks = await store.loadAllForProfile("p1");
    expect(masks).toHaveLength(1);
    expect(Array.from(masks[0].data)).toEqual([1]);
  });
});
