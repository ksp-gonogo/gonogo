import { describe, expect, it, vi } from "vitest";
import { CoverageMaskCache } from "./CoverageMaskCache";

const HI = "altimetry-hi";
const LO = "altimetry-lo";

function makeCache() {
  return new CoverageMaskCache({ width: 4, height: 2 });
}

describe("CoverageMaskCache", () => {
  it("allocates a zeroed mask on first acquire", () => {
    const mask = makeCache().acquire("Kerbin", HI);
    expect(mask.layerId).toBe(HI);
    expect(Array.from(mask.data)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("returns the same mask instance on repeat acquire for one (body, layerId)", () => {
    const cache = makeCache();
    expect(cache.acquire("Kerbin", HI)).toBe(cache.acquire("Kerbin", HI));
  });

  it("keeps each layer and each body apart", () => {
    const cache = makeCache();
    cache.acquire("Kerbin", HI).data[0] = 255;
    expect(cache.acquire("Kerbin", LO).data[0]).toBe(0);
    expect(cache.acquire("Mun", HI).data[0]).toBe(0);
  });

  it("answers get with undefined until the mask is acquired", () => {
    const cache = makeCache();
    expect(cache.get("Kerbin", HI)).toBeUndefined();
    const mask = cache.acquire("Kerbin", HI);
    expect(cache.get("Kerbin", HI)).toBe(mask);
  });

  it("tells a subscriber when its mask is marked dirty, and stops after unsubscribe", () => {
    const cache = makeCache();
    const listener = vi.fn();
    const unsubscribe = cache.onChange("Kerbin", HI, listener);
    const mask = cache.acquire("Kerbin", HI);

    mask.data[1] = 255;
    cache.markDirty("Kerbin", HI);
    expect(listener).toHaveBeenCalledWith(mask);

    unsubscribe();
    cache.markDirty("Kerbin", HI);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("subscribes before the first acquire to the mask that acquire then returns", () => {
    const cache = makeCache();
    const listener = vi.fn();
    cache.onChange("Kerbin", HI, listener);
    const mask = cache.acquire("Kerbin", HI);
    cache.markDirty("Kerbin", HI);
    expect(listener).toHaveBeenCalledWith(mask);
  });

  it("zeroes the mask on clear and tells its subscribers", () => {
    const cache = makeCache();
    const mask = cache.acquire("Kerbin", HI);
    mask.data.fill(255);
    const listener = vi.fn();
    cache.onChange("Kerbin", HI, listener);

    cache.clear("Kerbin", HI);

    expect(Array.from(mask.data)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(listener).toHaveBeenCalledWith(mask);
  });
});
