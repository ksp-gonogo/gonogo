import type {} from "@ksp-gonogo/components"; // pulls the "map-view.base" SlotRegistry merge into this program
import type { DataKey, SlotProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  clearRegistry,
  MockDataSource,
  registerDataSource,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SCANHeightGrid } from "../schema";
import { ALTIMETRY_LAYER_ID } from "./AltimetryBase";
// Importing the real module (not a throwaway test double) runs its
// module-load `registerAugment(...)` exactly once — same convention as
// FootprintOverlay/index.test.tsx and CoveragePanel/index.test.tsx.
import "./AltimetryBase";
import { BASE_LAYER_CANVAS_H, BASE_LAYER_CANVAS_W } from "./paintTile";

function encodeInt16LE(values: number[]): string {
  const buf = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => {
    buf.writeInt16LE(v, i * 2);
  });
  return buf.toString("base64");
}

function heightGridFixture(): SCANHeightGrid {
  // 2x2 grid: sea level, low, high, peak.
  return {
    width: 2,
    height: 2,
    minMetres: 0,
    maxMetres: 1000,
    heights: encodeInt16LE([0, 250, 750, 1000]),
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
    activeLayerId: ALTIMETRY_LAYER_ID,
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

describe("AltimetryBase — map-view.base slot", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  // Shared across every getContext("2d") call in a test (mirrors a real
  // canvas: repeated getContext calls on the same element return the same
  // logical context) — a fresh object literal per call, as FootprintOverlay's
  // test used, would silently make later `canvas.getContext("2d")` calls in
  // the test body return an empty, disconnected recorder.
  let paintCalls: string[];
  let paintFillStyles: string[];

  beforeEach(async () => {
    clearRegistry();
    registerStockBodies();
    const keys: DataKey[] = [{ key: "scansat.height.Kerbin" }];
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
      source.emit("scansat.height.Kerbin", heightGridFixture());
    });
    expect(onLayer).not.toHaveBeenCalled();
  });

  it("calls onLayer(null, 0) once live but activeLayerId doesn't match this augment's id", async () => {
    const onLayer = vi.fn();
    const { transport } = mountWithAvailability(
      baseLayerProps({ onLayer, activeLayerId: "scansat:biome" }),
    );
    act(() => {
      source.emit("scansat.height.Kerbin", heightGridFixture());
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
      // Deliberately a very different "viewport size" from the fixed paint
      // resolution — proves the canvas allocation ignores ctx.width/height.
      baseLayerProps({ onLayer, width: 321, height: 111 }),
    );
    act(() => {
      source.emit("scansat.height.Kerbin", heightGridFixture());
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
      source.emit("scansat.height.Kerbin", heightGridFixture());
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
      source.emit("scansat.height.Kerbin", heightGridFixture());
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });
    await waitFor(() => expect(onLayer).toHaveBeenCalled());
    expect(paintCalls.some((c) => c.startsWith("fillRect"))).toBe(true);
    expect(paintFillStyles.every((s) => s.endsWith(", 1)"))).toBe(true);
  });

  it("paints the colormap unconditionally when hasAnySource is false (degenerate open case)", async () => {
    const onLayer = vi.fn();
    const { transport } = mountWithAvailability(
      baseLayerProps({ onLayer, coverageGate: openGate() }),
    );
    act(() => {
      source.emit("scansat.height.Kerbin", heightGridFixture());
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });
    await waitFor(() => expect(onLayer).toHaveBeenCalled());
    expect(paintCalls.some((c) => c.startsWith("fillRect"))).toBe(true);
  });
});
