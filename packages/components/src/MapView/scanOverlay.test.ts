import type { BodyDefinition, SCANScanningVessel } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import { drawScanningFootprints } from "./scanOverlay";

// The anomaly-distance geometry (greatCircleMetres/initialBearingDeg/
// compassPoint/rankAnomaliesByDistance) that used to be tested here moved to
// mod/GonogoScansatUplink/client/src/AnomalyOverlay alongside the display
// itself (P4c-b) — see that package's own test suite.

describe("drawScanningFootprints", () => {
  const kerbin: BodyDefinition = {
    name: "Kerbin",
    radius: 600_000,
  } as BodyDefinition;

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

  it("skips vessels on a different body", () => {
    const ctx = fakeCtx();
    drawScanningFootprints(ctx, kerbin, [vessel({ body: "Mun" })], 1);
    expect((ctx as unknown as { calls: string[] }).calls).toHaveLength(0);
  });

  it("skips vessels with no in-range footprint (null/zero half-widths)", () => {
    const ctx = fakeCtx();
    drawScanningFootprints(
      ctx,
      kerbin,
      [vessel({ groundTrackWidthDeg: null, groundTrackLonHalfDeg: null })],
      1,
    );
    expect((ctx as unknown as { calls: string[] }).calls).toHaveLength(0);
  });

  it("paints a rect for an in-range vessel", () => {
    const ctx = fakeCtx();
    drawScanningFootprints(ctx, kerbin, [vessel({})], 1);
    const calls = (ctx as unknown as { calls: string[] }).calls;
    expect(calls.some((c) => c.startsWith("fillRect"))).toBe(true);
    expect(calls.some((c) => c.startsWith("strokeRect"))).toBe(true);
  });

  it("splits into two rects when the footprint wraps the antimeridian", () => {
    const ctx = fakeCtx();
    drawScanningFootprints(
      ctx,
      kerbin,
      [
        vessel({
          subLongitude: 179,
          groundTrackLonHalfDeg: 5,
        }),
      ],
      1,
    );
    const calls = (ctx as unknown as { calls: string[] }).calls;
    expect(calls.filter((c) => c.startsWith("fillRect")).length).toBe(2);
  });
});
