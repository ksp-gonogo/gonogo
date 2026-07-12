import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { deriveDvLegacyScalars } from "./dv-legacy-scalars";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import type { DerivedGet } from "./timeline-store";

interface StageDeltaVWireEntry {
  stage?: number | null;
  dvActual?: number | null;
  dryMass?: number | null;
  fuelMass?: number | null;
}

interface VesselStructureWirePayload {
  currentStage?: number | null;
}

function point<T>(payload: T | null): TimelinePoint<T> {
  return {
    validAt: 0,
    payload: payload as T,
    meta: makeMeta({ validAt: 0, quality: Quality.OnRails, source: "vessel" }),
    epoch: 0,
  };
}

function fakeGet(
  stages: TimelinePoint<StageDeltaVWireEntry[]> | undefined,
  structure: TimelinePoint<VesselStructureWirePayload> | undefined,
): DerivedGet {
  return (<T>(topic: string) => {
    if (topic === "dv.stages") return stages as unknown as TimelinePoint<T>;
    if (topic === "vessel.structure")
      return structure as unknown as TimelinePoint<T>;
    return undefined;
  }) as DerivedGet;
}

// Mirrors the real `Sitrep.Contract.StageDeltaVEntry` wire shape — camelCase
// dvActual (never deltaVActual), no stageMass field at all.
const STAGES: StageDeltaVWireEntry[] = [
  { stage: 2, dvActual: 300, dryMass: 100, fuelMass: 400 },
  { stage: 1, dvActual: 500, dryMass: 200, fuelMass: 800 },
  { stage: 0, dvActual: 200, dryMass: 300, fuelMass: 0 },
];

describe("deriveDvLegacyScalars — dv.total/current/currentFuelMass/totalMass off dv.stages + vessel.structure.currentStage", () => {
  it("undefined while dv.stages hasn't arrived", () => {
    expect(
      deriveDvLegacyScalars(fakeGet(undefined, point({ currentStage: 1 }))),
    ).toBeUndefined();
  });

  it("null on a confirmed dv.stages tombstone", () => {
    expect(
      deriveDvLegacyScalars(fakeGet(point(null), point({ currentStage: 1 }))),
    ).toBeNull();
  });

  it("undefined while vessel.structure hasn't arrived", () => {
    expect(
      deriveDvLegacyScalars(fakeGet(point(STAGES), undefined)),
    ).toBeUndefined();
  });

  it("null on a confirmed vessel.structure tombstone", () => {
    expect(
      deriveDvLegacyScalars(fakeGet(point(STAGES), point(null))),
    ).toBeNull();
  });

  it("total is the sum of every stage's dvActual", () => {
    const result = deriveDvLegacyScalars(
      fakeGet(point(STAGES), point({ currentStage: 1 })),
    );
    expect(result?.total).toBe(300 + 500 + 200);
  });

  it("totalMass sums dryMass + fuelMass across every stage (no stageMass field on the wire)", () => {
    const result = deriveDvLegacyScalars(
      fakeGet(point(STAGES), point({ currentStage: 1 })),
    );
    expect(result?.totalMass).toBe(100 + 400 + (200 + 800) + (300 + 0));
  });

  it("current/currentFuelMass pick the stage matching vessel.structure.currentStage", () => {
    const result = deriveDvLegacyScalars(
      fakeGet(point(STAGES), point({ currentStage: 1 })),
    );
    expect(result?.current).toBe(500);
    expect(result?.currentFuelMass).toBe(800);
  });

  it("tracks staging — a different currentStage reads a different stage", () => {
    const result = deriveDvLegacyScalars(
      fakeGet(point(STAGES), point({ currentStage: 2 })),
    );
    expect(result?.current).toBe(300);
    expect(result?.currentFuelMass).toBe(400);
  });

  it("current/currentFuelMass are null (not fabricated 0) when currentStage matches nothing", () => {
    const result = deriveDvLegacyScalars(
      fakeGet(point(STAGES), point({ currentStage: 99 })),
    );
    expect(result?.current).toBeNull();
    expect(result?.currentFuelMass).toBeNull();
    // total/totalMass are unaffected — they sum every stage regardless.
    expect(result?.total).toBe(1000);
  });

  it("accepts the legacy deltaVActual field name too (BufferedDataSource-shaped fixtures)", () => {
    const legacyShaped: StageDeltaVWireEntry[] = [
      { stage: 0, dryMass: 10, fuelMass: 20 } as StageDeltaVWireEntry,
    ];
    (legacyShaped[0] as unknown as Record<string, unknown>).deltaVActual = 42;
    const result = deriveDvLegacyScalars(
      fakeGet(point(legacyShaped), point({ currentStage: 0 })),
    );
    expect(result?.total).toBe(42);
    expect(result?.current).toBe(42);
  });
});
