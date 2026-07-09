import { Quality } from "@gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import { deriveSystemState } from "./system-state";
import type { TimelinePoint } from "./timeline";
import type { DerivedGet } from "./timeline-store";
import type { SystemBodiesPayload } from "./vessel-state";

function bodiesPoint(
  payload: SystemBodiesPayload | null,
): TimelinePoint<SystemBodiesPayload> {
  return {
    validAt: 0,
    payload,
    meta: makeMeta({ validAt: 0, quality: Quality.OnRails, source: "system" }),
    epoch: 0,
  };
}

function fakeGet(
  point: TimelinePoint<SystemBodiesPayload> | undefined,
): DerivedGet {
  return (<T>(topic: string) =>
    topic === "system.bodies"
      ? (point as unknown as TimelinePoint<T> | undefined)
      : undefined) as DerivedGet;
}

const THREE_BODIES: SystemBodiesPayload = {
  bodies: [
    { name: "Kerbol", index: 0, parentIndex: null, radius: 1, orbit: null },
    { name: "Kerbin", index: 1, parentIndex: 0, radius: 1, orbit: null },
    { name: "Mun", index: 2, parentIndex: 1, radius: 1, orbit: null },
  ],
};

describe("deriveSystemState — bodyCount (batch-2: b.number off the raw system.bodies array)", () => {
  it("counts the bodies in system.bodies", () => {
    expect(deriveSystemState(fakeGet(bodiesPoint(THREE_BODIES)))).toEqual({
      bodyCount: 3,
    });
  });

  it("reports 0 for an empty (but present) body array — a defined count, not resyncing", () => {
    expect(deriveSystemState(fakeGet(bodiesPoint({ bodies: [] })))).toEqual({
      bodyCount: 0,
    });
  });

  it("undefined while system.bodies hasn't arrived (resyncing) — never throws", () => {
    expect(deriveSystemState(fakeGet(undefined))).toBeUndefined();
  });

  it("null on a confirmed system.bodies tombstone", () => {
    expect(deriveSystemState(fakeGet(bodiesPoint(null)))).toBeNull();
  });
});
