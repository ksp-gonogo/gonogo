import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  deriveCurrentStageResourceCurrent,
  deriveCurrentStageResourceMax,
} from "./dv-stage-resources";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import type { DerivedGet } from "./timeline-store";

interface StageResourceWireEntry {
  current?: number | null;
  max?: number | null;
}

interface StageDeltaVWireEntry {
  stage?: number | null;
  resources?: Record<string, StageResourceWireEntry | null | undefined> | null;
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

const STAGES: StageDeltaVWireEntry[] = [
  {
    stage: 2,
    resources: {
      LiquidFuel: { current: 400, max: 400 },
      Oxidizer: { current: 480, max: 480 },
    },
  },
  {
    stage: 1,
    resources: {
      LiquidFuel: { current: 800, max: 1000 },
      Oxidizer: { current: 980, max: 1220 },
    },
  },
  {
    stage: 0,
    resources: {},
  },
];

describe("deriveCurrentStageResourceCurrent/Max — the r.resourceCurrent(Max)[X] pair off dv.stages + vessel.structure.currentStage", () => {
  it("undefined while dv.stages hasn't arrived", () => {
    expect(
      deriveCurrentStageResourceCurrent(
        fakeGet(undefined, point({ currentStage: 1 })),
      ),
    ).toBeUndefined();
  });

  it("null on a confirmed dv.stages tombstone", () => {
    expect(
      deriveCurrentStageResourceCurrent(
        fakeGet(point(null), point({ currentStage: 1 })),
      ),
    ).toBeNull();
  });

  it("undefined while vessel.structure hasn't arrived", () => {
    expect(
      deriveCurrentStageResourceCurrent(fakeGet(point(STAGES), undefined)),
    ).toBeUndefined();
  });

  it("null on a confirmed vessel.structure tombstone", () => {
    expect(
      deriveCurrentStageResourceCurrent(fakeGet(point(STAGES), point(null))),
    ).toBeNull();
  });

  it("picks the resources off the dv.stages entry matching vessel.structure.currentStage", () => {
    expect(
      deriveCurrentStageResourceCurrent(
        fakeGet(point(STAGES), point({ currentStage: 1 })),
      ),
    ).toEqual({ LiquidFuel: 800, Oxidizer: 980 });

    expect(
      deriveCurrentStageResourceMax(
        fakeGet(point(STAGES), point({ currentStage: 1 })),
      ),
    ).toEqual({ LiquidFuel: 1000, Oxidizer: 1220 });
  });

  it("tracks staging — a different currentStage reads a different stage's resources", () => {
    expect(
      deriveCurrentStageResourceCurrent(
        fakeGet(point(STAGES), point({ currentStage: 2 })),
      ),
    ).toEqual({ LiquidFuel: 400, Oxidizer: 480 });
  });

  it("empty map when currentStage matches a stage carrying no resources", () => {
    expect(
      deriveCurrentStageResourceCurrent(
        fakeGet(point(STAGES), point({ currentStage: 0 })),
      ),
    ).toEqual({});
  });

  it("empty map when currentStage doesn't match any dv.stages entry", () => {
    expect(
      deriveCurrentStageResourceCurrent(
        fakeGet(point(STAGES), point({ currentStage: 99 })),
      ),
    ).toEqual({});
  });

  it("empty map when currentStage itself isn't a number yet", () => {
    expect(
      deriveCurrentStageResourceCurrent(
        fakeGet(point(STAGES), point({ currentStage: null })),
      ),
    ).toEqual({});
  });

  it("omits a resource entry whose current/max isn't a finite number, never fabricating 0", () => {
    const stages: StageDeltaVWireEntry[] = [
      {
        stage: 1,
        resources: {
          LiquidFuel: { current: 800, max: 1000 },
          Weird: { current: null, max: 5 },
        },
      },
    ];
    expect(
      deriveCurrentStageResourceCurrent(
        fakeGet(point(stages), point({ currentStage: 1 })),
      ),
    ).toEqual({ LiquidFuel: 800 });
  });
});
