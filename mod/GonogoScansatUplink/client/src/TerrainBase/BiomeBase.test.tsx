import {
  clearRegistry,
  MockDataSource,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import {
  AugmentSlot,
  type DataKey,
  Quality,
  registerDataSource,
  type SlotProps,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SCANBiomeGrid } from "../schema";
import { BIOME_LAYER_ID, packedColourToComponents } from "./BiomeBase";
// Importing the real module (not a throwaway test double) runs its
// module-load `registerAugment(...)` exactly once — same convention as
// AltimetryBase.test.tsx / FootprintOverlay/index.test.tsx.
import "./BiomeBase";
import { BASE_LAYER_CANVAS_H, BASE_LAYER_CANVAS_W } from "./paintTile";

function encodeBytes(values: number[]): string {
  return Buffer.from(values).toString("base64");
}

function biomeGridFixture(): SCANBiomeGrid {
  // 2x2 grid: three cells in "Grasslands" (index 0), one cell with no
  // biome (0xFF — exercises paintTile's "skip this cell" path).
  return {
    width: 2,
    height: 2,
    biomes: [
      { name: "Grasslands", displayName: "Grasslands", colour: 0x33cc66 },
    ],
    indices: encodeBytes([0, 0, 0, 0xff]),
  };
}

function openGate() {
  return { data: null, version: 0, width: 0, height: 0, hasAnySource: false };
}

function fullyCoveredGate() {
  const width = 4;
  const height = 4;
  return {
    data: new Uint8Array(width * height).fill(255),
    version: 1,
    width,
    height,
    hasAnySource: true,
  };
}

function fullyUncoveredGate() {
  const width = 4;
  const height = 4;
  return {
    data: new Uint8Array(width * height),
    version: 1,
    width,
    height,
    hasAnySource: true,
  };
}

function baseLayerProps(
  overrides: Partial<SlotProps<"map-view.base">> = {},
): SlotProps<"map-view.base"> {
  return {
    bodyId: "Kerbin",
    activeLayerId: BIOME_LAYER_ID,
    width: 900,
    height: 500,
    augmentSettings: undefined,
    coverageGate: openGate(),
    onLayer: vi.fn(),
    ...overrides,
  };
}

const renderedTrees: Array<() => void> = [];

function renderSlot(ui: ReactElement) {
  const result = render(ui);
  renderedTrees.push(result.unmount);
  return result;
}

describe("packedColourToComponents", () => {
  it("unpacks 0xRRGGBB into 'r, g, b' components", () => {
    expect(packedColourToComponents(0x336699)).toBe("51, 102, 153");
  });
});

describe("BiomeBase — map-view.base slot", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  // Shared across every getContext("2d") call in a test — see
  // AltimetryBase.test.tsx's identical setup for why a fresh object literal
  // per call (FootprintOverlay's original pattern) doesn't work here: the
  // component itself never re-fetches the context after painting, but a
  // shared recorder keeps the setup consistent and simple either way.
  let paintCalls: string[];
  let paintFillStyles: string[];

  beforeEach(async () => {
    clearRegistry();
    registerStockBodies();
    const keys: DataKey[] = [{ key: "scansat.biome.Kerbin" }];
    source = new MockDataSource({ keys });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();

    paintCalls = [];
    paintFillStyles = [];
    let currentFillStyle = "";
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = ((contextId: string): unknown => {
      if (contextId !== "2d") return null;
      return {
        clearRect: (...args: number[]) =>
          paintCalls.push(`clearRect ${args.join(",")}`),
        fillRect: (...args: number[]) => {
          paintCalls.push(`fillRect ${args.join(",")}`);
          paintFillStyles.push(currentFillStyle);
        },
        get fillStyle() {
          return currentFillStyle;
        },
        set fillStyle(v: string) {
          currentFillStyle = v;
        },
      };
    }) as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    buffered.disconnect();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  function mountWithAvailability(props: SlotProps<"map-view.base">) {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    renderSlot(
      <TelemetryProvider client={client}>
        <AugmentSlot name="map-view.base" props={props} />
      </TelemetryProvider>,
    );
    return { transport };
  }

  it("never calls onLayer while the scansat domain has not announced availability", () => {
    const onLayer = vi.fn();
    renderSlot(
      <AugmentSlot name="map-view.base" props={baseLayerProps({ onLayer })} />,
    );
    act(() => {
      source.emit("scansat.biome.Kerbin", biomeGridFixture());
    });
    expect(onLayer).not.toHaveBeenCalled();
  });

  it("calls onLayer(null, 0) once live but activeLayerId doesn't match this augment's id", async () => {
    const onLayer = vi.fn();
    const { transport } = mountWithAvailability(
      baseLayerProps({ onLayer, activeLayerId: "scansat:altimetry" }),
    );
    act(() => {
      source.emit("scansat.biome.Kerbin", biomeGridFixture());
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });
    await waitFor(() => {
      expect(onLayer).toHaveBeenCalledWith(null, 0);
    });
  });

  it("paints a fixed BASE_LAYER_CANVAS_W x H canvas when active, regardless of the live width/height passed down", async () => {
    const onLayer = vi.fn();
    const { transport } = mountWithAvailability(
      baseLayerProps({ onLayer, width: 321, height: 111 }),
    );
    act(() => {
      source.emit("scansat.biome.Kerbin", biomeGridFixture());
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });
    await waitFor(() => {
      expect(onLayer).toHaveBeenCalled();
    });
    const [canvas] = onLayer.mock.calls[onLayer.mock.calls.length - 1] as [
      HTMLCanvasElement,
      number,
    ];
    expect(canvas.width).toBe(BASE_LAYER_CANVAS_W);
    expect(canvas.height).toBe(BASE_LAYER_CANVAS_H);
  });

  it("paints nothing when every tile is fully uncovered", async () => {
    const onLayer = vi.fn();
    const { transport } = mountWithAvailability(
      baseLayerProps({ onLayer, coverageGate: fullyUncoveredGate() }),
    );
    act(() => {
      source.emit("scansat.biome.Kerbin", biomeGridFixture());
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });
    await waitFor(() => expect(onLayer).toHaveBeenCalled());
    expect(paintCalls.length).toBeGreaterThan(0);
    expect(paintCalls.every((c) => c.startsWith("clearRect"))).toBe(true);
  });

  it("paints the colormap at full opacity when every tile is fully covered", async () => {
    const onLayer = vi.fn();
    const { transport } = mountWithAvailability(
      baseLayerProps({ onLayer, coverageGate: fullyCoveredGate() }),
    );
    act(() => {
      source.emit("scansat.biome.Kerbin", biomeGridFixture());
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });
    await waitFor(() => expect(onLayer).toHaveBeenCalled());
    expect(paintCalls.some((c) => c.startsWith("fillRect"))).toBe(true);
    expect(paintFillStyles.every((s) => s.endsWith(", 1)"))).toBe(true);
    // The 0xFF ("no biome") cell must never be painted.
    expect(paintFillStyles.length).toBeLessThan(4);
  });

  it("paints the colormap unconditionally when hasAnySource is false (degenerate open case)", async () => {
    const onLayer = vi.fn();
    const { transport } = mountWithAvailability(
      baseLayerProps({ onLayer, coverageGate: openGate() }),
    );
    act(() => {
      source.emit("scansat.biome.Kerbin", biomeGridFixture());
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });
    await waitFor(() => expect(onLayer).toHaveBeenCalled());
    expect(paintCalls.some((c) => c.startsWith("fillRect"))).toBe(true);
  });
});
