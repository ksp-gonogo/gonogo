import { clearRegistry, MockDataSource } from "@ksp-gonogo/core";
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drawFootprints } from "./index";
// Importing the real module (not a throwaway test double) runs its
// module-load `registerAugment(...)` exactly once — same convention as
// AnomalyOverlay/slot.test.tsx.
import "./index";
import type { SCANScanningVessel } from "../schema";

function vessel(over: Partial<SCANScanningVessel>): SCANScanningVessel {
  return {
    vesselId: "v1",
    vesselName: "Mapper",
    body: "Kerbin",
    subLatitude: 0,
    subLongitude: 0,
    altitude: 250_000,
    sensors: [],
    groundTrackWidthDeg: 6,
    groundTrackLonHalfDeg: 6.1,
    trackColor: { r: 0, g: 255, b: 200, a: 200 },
    ...over,
  };
}

function fakeCtx() {
  const calls: string[] = [];
  return {
    calls,
    fillRect: (...args: number[]) => calls.push(`fillRect ${args.join(",")}`),
    strokeRect: (...args: number[]) =>
      calls.push(`strokeRect ${args.join(",")}`),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D;
}

describe("drawFootprints — pure geometry", () => {
  it("skips vessels on a different body", () => {
    const ctx = fakeCtx();
    drawFootprints(
      ctx,
      600,
      "Kerbin",
      [vessel({ body: "Mun" })],
      (lat, lon) => ({
        x: lon,
        y: lat,
      }),
    );
    expect((ctx as unknown as { calls: string[] }).calls).toHaveLength(0);
  });

  it("skips vessels with no in-range footprint (null/zero half-widths)", () => {
    const ctx = fakeCtx();
    drawFootprints(
      ctx,
      600,
      "Kerbin",
      [vessel({ groundTrackWidthDeg: null, groundTrackLonHalfDeg: null })],
      (lat, lon) => ({ x: lon, y: lat }),
    );
    expect((ctx as unknown as { calls: string[] }).calls).toHaveLength(0);
  });

  it("paints a rect for an in-range vessel", () => {
    const ctx = fakeCtx();
    drawFootprints(ctx, 600, "Kerbin", [vessel({})], (lat, lon) => ({
      x: lon,
      y: lat,
    }));
    const calls = (ctx as unknown as { calls: string[] }).calls;
    expect(calls.some((c) => c.startsWith("fillRect"))).toBe(true);
    expect(calls.some((c) => c.startsWith("strokeRect"))).toBe(true);
  });

  it("splits into two rects when the footprint wraps the antimeridian", () => {
    const ctx = fakeCtx();
    drawFootprints(
      ctx,
      600,
      "Kerbin",
      [vessel({ subLongitude: 179, groundTrackLonHalfDeg: 5 })],
      (lat, lon) => ({ x: lon, y: lat }),
    );
    const calls = (ctx as unknown as { calls: string[] }).calls;
    expect(calls.filter((c) => c.startsWith("fillRect")).length).toBe(2);
  });

  // The gotcha this task exists to fix: the old MapView-internal
  // `drawScanningFootprints` pre-divided its stroke width by camera zoom
  // (`Math.max(0.75, 1 / camZoom)`) because it drew onto a canvas that ALSO
  // had a zoom-scaling `ctx.setTransform(...)` applied by the caller — the
  // pre-division cancelled that transform's own scaling so the on-screen
  // stroke stayed ~1 physical pixel. This augment draws via `ctx.project()`,
  // which already hands back post-camera-transform SCREEN pixels — there is
  // no second canvas-level zoom transform here to compensate for. Carrying
  // the `1 / zoom` division over unchanged would make the stroke thinner at
  // high zoom and thicker at low zoom (backwards from the original intent).
  // The correct fix is a fixed screen-space width — this pins that constant
  // and proves it does NOT vary with the projection a caller simulating a
  // different zoom level hands in.
  it("uses a fixed screen-space stroke width, independent of zoom", () => {
    const zoom1 = fakeCtx();
    drawFootprints(zoom1, 600, "Kerbin", [vessel({})], (lat, lon) => ({
      x: lon,
      y: lat,
    }));
    expect(zoom1.lineWidth).toBe(1.5);

    // Simulate a highly zoomed-in projection (10x scale) — a naive `1 /
    // camZoom` port would shrink the stroke here. The fixed constant must
    // not move.
    const zoom10 = fakeCtx();
    drawFootprints(zoom10, 6000, "Kerbin", [vessel({})], (lat, lon) => ({
      x: lon * 10,
      y: lat * 10,
    }));
    expect(zoom10.lineWidth).toBe(1.5);
    expect(zoom10.lineWidth).toBe(zoom1.lineWidth);
  });
});

// Rendered trees, tracked so afterEach can unmount them BEFORE disconnecting
// the buffered source. RTL auto-cleanup runs after this file's afterEach, so it
// can't be relied on to unmount first — disconnecting a live source while the
// widget is still mounted fires a status change into it, a state update outside
// act() (the documented anti-pattern in CLAUDE.md).
const renderedTrees: Array<() => void> = [];

function renderSlot(ui: ReactElement) {
  const result = render(ui);
  renderedTrees.push(result.unmount);
  return result;
}

function overlayProps(
  overrides: Partial<SlotProps<"map-view.overlay">> = {},
): SlotProps<"map-view.overlay"> {
  return {
    width: 600,
    height: 300,
    camera: { zoom: 1, panX: 0, panY: 0 },
    worldW: 4096,
    worldH: 2048,
    bodyName: "Kerbin",
    bodyRadius: 600_000,
    vesselLat: undefined,
    vesselLon: undefined,
    project: (lat: number, lon: number) => ({ x: lon, y: lat }),
    ...overrides,
  };
}

describe("FootprintOverlay — map-view.overlay slot", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

  beforeEach(async () => {
    clearRegistry();
    const keys: DataKey[] = [{ key: "scansat.scanningVessels" }];
    source = new MockDataSource({ keys });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
    originalGetContext = HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    buffered.disconnect();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it("does not mount while the scansat domain has not announced availability", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    const { container } = renderSlot(
      <TelemetryProvider client={client}>
        <AugmentSlot name="map-view.overlay" props={overlayProps()} />
      </TelemetryProvider>,
    );
    act(() => {
      source.emit("scansat.scanningVessels", [vessel({})]);
    });

    expect(container.querySelector("canvas")).toBeNull();
  });

  it("stays absent when the scansat domain is unavailable but no provider is mounted", () => {
    // No TelemetryProvider at all — the app-realistic case of a KSP install
    // with no SCANsat mod present: scansat.available never arrives.
    const { container } = renderSlot(
      <AugmentSlot name="map-view.overlay" props={overlayProps()} />,
    );
    act(() => {
      source.emit("scansat.scanningVessels", [vessel({})]);
    });

    expect(container.querySelector("canvas")).toBeNull();
  });

  it("mounts a canvas and draws footprints once the domain is live", async () => {
    const calls: string[] = [];
    HTMLCanvasElement.prototype.getContext = ((contextId: string): unknown => {
      if (contextId !== "2d") return null;
      return {
        calls,
        fillRect: (...args: number[]) =>
          calls.push(`fillRect ${args.join(",")}`),
        strokeRect: (...args: number[]) =>
          calls.push(`strokeRect ${args.join(",")}`),
        clearRect: () => calls.push("clearRect"),
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 0,
      };
    }) as typeof HTMLCanvasElement.prototype.getContext;

    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    const { container } = renderSlot(
      <TelemetryProvider client={client}>
        <AugmentSlot name="map-view.overlay" props={overlayProps()} />
      </TelemetryProvider>,
    );
    act(() => {
      source.emit("scansat.scanningVessels", [vessel({})]);
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });

    await waitFor(() => {
      expect(container.querySelector("canvas")).not.toBeNull();
    });
    await waitFor(() => {
      expect(calls.some((c) => c.startsWith("fillRect"))).toBe(true);
    });
  });
});
