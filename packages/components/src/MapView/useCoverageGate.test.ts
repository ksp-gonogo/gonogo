import "fake-indexeddb/auto";
import type { CoverageSourceDefinition } from "@ksp-gonogo/core";
import { clearCoverageSources, registerCoverageSource } from "@ksp-gonogo/core";
import type { BodyMask } from "@ksp-gonogo/data";
import { CoverageMaskCacheProvider, CoverageMaskStore } from "@ksp-gonogo/data";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { compositeCoverage, useCoverageGate } from "./useCoverageGate";

// Unmounted in afterEach before clearCoverageSources() notifies subscribers, which would be a state update outside act(); RTL's auto-cleanup runs too late.
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearCoverageSources();
});

function mask(data: number[]): BodyMask {
  return {
    bodyId: "Kerbin",
    layerId: "x",
    width: data.length,
    height: 1,
    data: new Uint8Array(data),
  };
}

describe("compositeCoverage: pure per-pixel math", () => {
  it("takes the MAX of weighted intensities across enabled sources at one pixel", () => {
    const sources: CoverageSourceDefinition[] = [
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
    const sources: CoverageSourceDefinition[] = [
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

  it("returns 0 (not fully-dark) when zero sources are enabled, no-coverage-system case", () => {
    expect(compositeCoverage([], new Map(), undefined, 0)).toBe(0);
  });
});

describe("useCoverageGate: hook integration", () => {
  it("hasAnySource is false with nothing registered, true once a source registers", async () => {
    const store = new CoverageMaskStore({
      dbName: `gonogo-coverage-test-${Math.random()}`,
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(CoverageMaskCacheProvider, { store, children });
    const { result, rerender, unmount } = renderHook(
      () => useCoverageGate("Kerbin", undefined),
      { wrapper },
    );
    renderedTrees.push(unmount);
    expect(result.current.hasAnySource).toBe(false);

    act(() => {
      registerCoverageSource({
        id: "example-uplink:altimetry-hi",
        weight: 255,
      });
      rerender();
    });
    await waitFor(() => expect(result.current.hasAnySource).toBe(true));
  });

  it("picks up a coverage source registered before ANY hook instance is mounted", () => {
    // A source registered before any instance mounts must still be in the cache when the first one does.
    registerCoverageSource({
      id: "example-uplink:altimetry-hi",
      weight: 255,
    });

    const store = new CoverageMaskStore({
      dbName: `gonogo-coverage-test-${Math.random()}`,
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(CoverageMaskCacheProvider, { store, children });
    const { result, unmount } = renderHook(
      () => useCoverageGate("Kerbin", undefined),
      { wrapper },
    );
    renderedTrees.push(unmount);

    expect(result.current.hasAnySource).toBe(true);
  });

  it("reports fully-open (hasAnySource false), not a null-data gated state, when no CoverageMaskCacheProvider is mounted", async () => {
    // A source with no cache provider must degrade to open, never blank the map.
    registerCoverageSource({
      id: "example-uplink:altimetry-hi",
      weight: 255,
    });

    const { result, unmount } = renderHook(() =>
      useCoverageGate("Kerbin", undefined),
    );
    renderedTrees.push(unmount);

    await waitFor(() => expect(result.current.hasAnySource).toBe(false));
    expect(result.current.data).toBeNull();
  });
});
