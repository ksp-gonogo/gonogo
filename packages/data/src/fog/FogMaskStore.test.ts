import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { FogMaskStore } from "./FogMaskStore";

function freshStore(): FogMaskStore {
  // Unique DB name per test so state never leaks between cases
  return new FogMaskStore({ dbName: `gonogo-fog-test-${Math.random()}` });
}

describe("FogMaskStore", () => {
  let store: FogMaskStore;

  beforeEach(() => {
    store = freshStore();
  });

  it("returns null for an un-saved mask", async () => {
    const result = await store.load("profile-1", "Kerbin");
    expect(result).toBeNull();
  });

  it("round-trips a mask", async () => {
    const data = new Uint8Array([10, 20, 30, 40]);
    await store.save("profile-1", "Kerbin", data, 2, 2);
    const loaded = await store.load("profile-1", "Kerbin");
    expect(loaded).not.toBeNull();
    expect(loaded?.width).toBe(2);
    expect(loaded?.height).toBe(2);
    expect(Array.from(loaded?.data ?? [])).toEqual([10, 20, 30, 40]);
  });

  it("overwrites on re-save", async () => {
    await store.save("p", "Kerbin", new Uint8Array([1]), 1, 1);
    await store.save("p", "Kerbin", new Uint8Array([2]), 1, 1);
    const loaded = await store.load("p", "Kerbin");
    expect(Array.from(loaded?.data ?? [])).toEqual([2]);
  });

  it("isolates different profiles and bodies", async () => {
    await store.save("p1", "Kerbin", new Uint8Array([1]), 1, 1);
    await store.save("p2", "Kerbin", new Uint8Array([2]), 1, 1);
    await store.save("p1", "Mun", new Uint8Array([3]), 1, 1);
    expect((await store.load("p1", "Kerbin"))?.data[0]).toBe(1);
    expect((await store.load("p2", "Kerbin"))?.data[0]).toBe(2);
    expect((await store.load("p1", "Mun"))?.data[0]).toBe(3);
  });

  it("clear removes only the specified profile+body", async () => {
    await store.save("p", "Kerbin", new Uint8Array([1]), 1, 1);
    await store.save("p", "Mun", new Uint8Array([2]), 1, 1);
    await store.clear("p", "Kerbin");
    expect(await store.load("p", "Kerbin")).toBeNull();
    expect(await store.load("p", "Mun")).not.toBeNull();
  });

  it("clearProfile removes every body for a profile", async () => {
    await store.save("p1", "Kerbin", new Uint8Array([1]), 1, 1);
    await store.save("p1", "Mun", new Uint8Array([2]), 1, 1);
    await store.save("p2", "Kerbin", new Uint8Array([3]), 1, 1);
    await store.clearProfile("p1");
    expect(await store.load("p1", "Kerbin")).toBeNull();
    expect(await store.load("p1", "Mun")).toBeNull();
    expect(await store.load("p2", "Kerbin")).not.toBeNull();
  });

  it("loadAllForProfile returns every body for a profile and only that profile", async () => {
    await store.save("p1", "Kerbin", new Uint8Array([1, 2]), 2, 1);
    await store.save("p1", "Mun", new Uint8Array([3, 4]), 2, 1);
    // Different profile — must NOT be returned.
    await store.save("p2", "Kerbin", new Uint8Array([9]), 1, 1);

    const masks = await store.loadAllForProfile("p1");
    expect(masks).toHaveLength(2);
    const byBody = new Map(
      masks.map((m) => [m.key.split(":")[1], Array.from(m.data)]),
    );
    expect(byBody.get("Kerbin")).toEqual([1, 2]);
    expect(byBody.get("Mun")).toEqual([3, 4]);
  });

  it("loadAllForProfile returns an empty array for a profile with no masks", async () => {
    expect(await store.loadAllForProfile("never-saved")).toEqual([]);
  });

  it("loadAllForProfile doesn't bleed across prefix-similar profile ids", async () => {
    // Bug class: a profile id that's a prefix of another (e.g. "p1" vs
    // "p1-extra") could be over-greedy if the cursor range bound is
    // mis-set. Lock the boundary down with an explicit case.
    await store.save("p1", "Kerbin", new Uint8Array([1]), 1, 1);
    await store.save("p1-extra", "Kerbin", new Uint8Array([2]), 1, 1);

    const masks = await store.loadAllForProfile("p1");
    expect(masks).toHaveLength(1);
    expect(Array.from(masks[0].data)).toEqual([1]);
  });
});
