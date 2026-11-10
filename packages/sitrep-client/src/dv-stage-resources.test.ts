import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  deriveCurrentStageResourceCurrent,
  deriveCurrentStageResourceMax,
} from "./dv-stage-resources";

interface StageResourceWireEntry {
  current?: Value<"units"> | null;
  max?: Value<"units"> | null;
}

/** KSP resource units, the unit the wire declares on both amounts. */
const units = (n: number) => value("units", n);

interface StageDeltaVWireEntry {
  stage?: number | null;
  resources?: Record<string, StageResourceWireEntry | null | undefined> | null;
}

const STAGES: StageDeltaVWireEntry[] = [
  {
    stage: 2,
    resources: {
      LiquidFuel: { current: units(400), max: units(400) },
      Oxidizer: { current: units(480), max: units(480) },
    },
  },
  {
    stage: 1,
    resources: {
      LiquidFuel: { current: units(800), max: units(1000) },
      Oxidizer: { current: units(980), max: units(1220) },
    },
  },
  {
    stage: 0,
    resources: {},
  },
];

describe("deriveCurrentStageResourceCurrent/Max: the r.resourceCurrent(Max)[X] pair off dv.stages + vessel.structure.currentStage", () => {
  it("undefined while dv.stages hasn't arrived", () => {
    expect(
      deriveCurrentStageResourceCurrent(undefined, { currentStage: 1 }),
    ).toBeUndefined();
  });

  it("null on a confirmed dv.stages tombstone", () => {
    expect(
      deriveCurrentStageResourceCurrent(null, { currentStage: 1 }),
    ).toBeNull();
  });

  it("undefined while vessel.structure hasn't arrived", () => {
    expect(
      deriveCurrentStageResourceCurrent(STAGES, undefined),
    ).toBeUndefined();
  });

  it("null on a confirmed vessel.structure tombstone", () => {
    expect(deriveCurrentStageResourceCurrent(STAGES, null)).toBeNull();
  });

  it("picks the resources off the dv.stages entry matching vessel.structure.currentStage", () => {
    expect(
      deriveCurrentStageResourceCurrent(STAGES, { currentStage: 1 }),
    ).toEqual({ LiquidFuel: units(800), Oxidizer: units(980) });

    expect(deriveCurrentStageResourceMax(STAGES, { currentStage: 1 })).toEqual({
      LiquidFuel: units(1000),
      Oxidizer: units(1220),
    });
  });

  it("tracks staging: a different currentStage reads a different stage's resources", () => {
    expect(
      deriveCurrentStageResourceCurrent(STAGES, { currentStage: 2 }),
    ).toEqual({ LiquidFuel: units(400), Oxidizer: units(480) });
  });

  it("empty map when currentStage matches a stage carrying no resources", () => {
    expect(
      deriveCurrentStageResourceCurrent(STAGES, { currentStage: 0 }),
    ).toEqual({});
  });

  it("empty map when currentStage is below every dv.stages entry", () => {
    expect(
      deriveCurrentStageResourceCurrent(STAGES, { currentStage: -1 }),
    ).toEqual({});
  });

  it("a currentStage with no dv.stages entry reads the nearest lower stage (probe: currentStage 1, only stage 0)", () => {
    const probe: StageDeltaVWireEntry[] = [
      {
        stage: 0,
        resources: {
          LiquidFuel: { current: units(180), max: units(180) },
          Oxidizer: { current: units(220), max: units(220) },
        },
      },
    ];
    const both = { LiquidFuel: units(180), Oxidizer: units(220) };
    const structure = { currentStage: 1 };
    expect(deriveCurrentStageResourceCurrent(probe, structure)).toEqual(both);
    expect(deriveCurrentStageResourceMax(probe, structure)).toEqual(both);
  });

  it("empty map when currentStage itself isn't a number yet", () => {
    expect(
      deriveCurrentStageResourceCurrent(STAGES, { currentStage: null }),
    ).toEqual({});
  });

  it("omits a resource entry whose current/max isn't a finite number, never fabricating 0", () => {
    const stages: StageDeltaVWireEntry[] = [
      {
        stage: 1,
        resources: {
          LiquidFuel: { current: units(800), max: units(1000) },
          Weird: { current: null, max: units(5) },
        },
      },
    ];
    expect(
      deriveCurrentStageResourceCurrent(stages, { currentStage: 1 }),
    ).toEqual({ LiquidFuel: units(800) });
  });
});
