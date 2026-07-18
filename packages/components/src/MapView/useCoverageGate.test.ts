import "fake-indexeddb/auto";
import type { FogRevealSourceDefinition } from "@ksp-gonogo/core";
import {
  clearFogRevealSources,
  registerFogRevealSource,
} from "@ksp-gonogo/core";
import type { BodyMask } from "@ksp-gonogo/data";
import { FogMaskCacheProvider, FogMaskStore } from "@ksp-gonogo/data";
import { renderHook, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { compositeCoverage, useCoverageGate } from "./useCoverageGate";

afterEach(() => clearFogRevealSources());

function mask(data: number[]): BodyMask {
  return {
    bodyId: "Kerbin",
    layerId: "x",
    width: data.length,
    height: 1,
    data: new Uint8Array(data),
  };
}

describe("compositeCoverage — pure per-pixel math", () => {
  it("takes the MAX of weighted intensities across enabled sources at one pixel", () => {
    const sources: FogRevealSourceDefinition[] = [
      { id: "example-uplink:altimetry-lo", weight: 192 },
      { id: "example-uplink:altimetry-hi", weight: 255 },
    ];
    const masks = new Map([
      ["example-uplink:altimetry-lo", mask([255])], // 255 * 192/255 = 192
      ["example-uplink:altimetry-hi", mask([100])], // 100 * 255/255 = 100
    ]);
    expect(compositeCoverage(sources, masks, undefined, 0)).toBe(192); // lo wins here
  });

  it("excludes a source whose augmentSettings.show is explicitly false", () => {
    const sources: FogRevealSourceDefinition[] = [
      { id: "example-uplink:biome", weight: 255 },
    ];
    const masks = new Map([["example-uplink:biome", mask([255])]]);
    expect(
      compositeCoverage(
        sources,
        masks,
        { "example-uplink:biome": { show: false } },
        0,
      ),
    ).toBe(0);
  });

  it("returns 0 (not fully-fogged-black) when zero sources are enabled — no-fog-system case", () => {
    expect(compositeCoverage([], new Map(), undefined, 0)).toBe(0);
  });
});

describe("useCoverageGate — hook integration", () => {
  it("hasAnySource is false with nothing registered, true once a source registers", async () => {
    const store = new FogMaskStore({
      dbName: `gonogo-fog-test-${Math.random()}`,
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(FogMaskCacheProvider, { store }, children);
    const { result, rerender } = renderHook(
      () => useCoverageGate("Kerbin", undefined),
      { wrapper },
    );
    expect(result.current.hasAnySource).toBe(false);

    registerFogRevealSource({
      id: "example-uplink:altimetry-hi",
      weight: 255,
    });
    rerender();
    await waitFor(() => expect(result.current.hasAnySource).toBe(true));
  });

  it("picks up a reveal source registered before ANY hook instance is mounted", () => {
    // Regression for the stale module-level cache: a reveal source can
    // register (e.g. an Uplink SDK bundle loading) before the user ever
    // navigates to a MapView layout, so no useCoverageGate instance is
    // mounted yet to catch the change. cachedSources must still be fresh
    // by the time the first instance mounts.
    registerFogRevealSource({
      id: "example-uplink:altimetry-hi",
      weight: 255,
    });

    const store = new FogMaskStore({
      dbName: `gonogo-fog-test-${Math.random()}`,
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(FogMaskCacheProvider, { store }, children);
    const { result } = renderHook(() => useCoverageGate("Kerbin", undefined), {
      wrapper,
    });

    expect(result.current.hasAnySource).toBe(true);
  });

  it("reports fully-open (hasAnySource false), not a null-data gated state, when no FogMaskCacheProvider is mounted", async () => {
    // A missing cache provider must never blank the map. With a source
    // registered but no provider in the tree, cache is null forever — the
    // gate must degrade to vanilla-open, not stay stuck reporting a source
    // is present while data can never arrive.
    registerFogRevealSource({
      id: "example-uplink:altimetry-hi",
      weight: 255,
    });

    const { result } = renderHook(() => useCoverageGate("Kerbin", undefined));

    await waitFor(() => expect(result.current.hasAnySource).toBe(false));
    expect(result.current.data).toBeNull();
  });
});
