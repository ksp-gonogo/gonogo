import type { StageInfo } from "@ksp-gonogo/core";
import { clearDerivedKeys, getDerivedKeys } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Sample } from "../types";
import { registerBuiltinDerivedKeys } from "./builtinDerivedKeys";

function sample<V>(v: V, t = 1000): Sample<V> {
  return { t, v };
}

function stage(overrides: Partial<StageInfo>): StageInfo {
  return {
    stage: 0,
    stageMass: 0,
    dryMass: 0,
    fuelMass: 0,
    startMass: 0,
    endMass: 0,
    burnTime: 0,
    deltaVVac: 0,
    deltaVASL: 0,
    deltaVActual: 0,
    TWRVac: 0,
    TWRASL: 0,
    TWRActual: 0,
    ispVac: 0,
    ispASL: 0,
    ispActual: 0,
    thrustVac: 0,
    thrustASL: 0,
    thrustActual: 0,
    ...overrides,
  };
}

function findDef(id: string) {
  const def = getDerivedKeys().find((d) => d.id === id);
  if (!def) throw new Error(`derived key ${id} not registered`);
  return def;
}

describe("builtin derived keys: delta-V / mass", () => {
  beforeEach(() => {
    clearDerivedKeys();
    registerBuiltinDerivedKeys();
  });
  afterEach(() => {
    clearDerivedKeys();
  });

  it("registers dv.* rollups alongside pre-existing derived keys", () => {
    const ids = getDerivedKeys().map((d) => d.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "v.missionTimeHours",
        "v.altitudeRate",
        "v.horizontalVelocity",
        "dv.total",
        "dv.current",
        "dv.currentTWR",
        "dv.currentFuelMass",
        "dv.totalMass",
      ]),
    );
  });

  it("v.horizontalVelocity = sqrt(orbital² - vertical²)", () => {
    const def = findDef("v.horizontalVelocity");
    expect(def.fn([sample(2300), sample(0)], null)).toBeCloseTo(2300);
    // 3-4-5 triangle: orbital 2500, vertical 1500 → horizontal 2000
    expect(def.fn([sample(2500), sample(1500)], null)).toBeCloseTo(2000);
  });

  it("v.horizontalVelocity clamps to 0 when vertical exceeds orbital due to FP noise", () => {
    const def = findDef("v.horizontalVelocity");
    expect(def.fn([sample(100), sample(100.0000001)], null)).toBe(0);
  });

  it("v.horizontalVelocity returns undefined when inputs aren't finite", () => {
    const def = findDef("v.horizontalVelocity");
    expect(def.fn([sample(NaN), sample(0)], null)).toBeUndefined();
    expect(def.fn([sample(100), sample(NaN)], null)).toBeUndefined();
  });

  it("dv.total sums deltaVActual across stages", () => {
    const def = findDef("dv.total");
    const stages = [
      stage({ stage: 3, deltaVActual: 1200 }),
      stage({ stage: 2, deltaVActual: 800 }),
      stage({ stage: 1, deltaVActual: 500 }),
    ];
    expect(def.fn([sample(stages)], null)).toBe(2500);
  });

  it("dv.total returns undefined when input isn't an array (no telemetry yet)", () => {
    const def = findDef("dv.total");
    expect(def.fn([sample(undefined)], null)).toBeUndefined();
    expect(def.fn([sample(null)], null)).toBeUndefined();
  });

  it("dv.current picks the stage matching v.currentStage", () => {
    const def = findDef("dv.current");
    const stages = [
      stage({ stage: 3, deltaVActual: 1200 }),
      stage({ stage: 2, deltaVActual: 800 }),
      stage({ stage: 1, deltaVActual: 500 }),
    ];
    expect(def.fn([sample(stages), sample(2)], null)).toBe(800);
    expect(def.fn([sample(stages), sample(1)], null)).toBe(500);
  });

  it("dv.current returns undefined when no stage matches", () => {
    const def = findDef("dv.current");
    const stages = [stage({ stage: 2, deltaVActual: 800 })];
    expect(def.fn([sample(stages), sample(5)], null)).toBeUndefined();
    expect(def.fn([sample(stages), sample(undefined)], null)).toBeUndefined();
  });

  it("dv.currentTWR pulls TWRActual from the active stage", () => {
    const def = findDef("dv.currentTWR");
    const stages = [
      stage({ stage: 2, TWRActual: 1.8 }),
      stage({ stage: 1, TWRActual: 2.4 }),
    ];
    expect(def.fn([sample(stages), sample(1)], null)).toBe(2.4);
  });

  it("dv.currentFuelMass pulls fuelMass from the active stage", () => {
    const def = findDef("dv.currentFuelMass");
    const stages = [
      stage({ stage: 2, fuelMass: 3200 }),
      stage({ stage: 1, fuelMass: 1450 }),
    ];
    expect(def.fn([sample(stages), sample(2)], null)).toBe(3200);
  });

  it("dv.totalMass sums stageMass across all stages", () => {
    const def = findDef("dv.totalMass");
    const stages = [
      stage({ stage: 2, stageMass: 8000 }),
      stage({ stage: 1, stageMass: 2500 }),
    ];
    expect(def.fn([sample(stages)], null)).toBe(10500);
  });
});

// Moved here with `builtinDerivedKeys` when the derive REGISTRY went to the sdk:
// these assert the shapes this package registers, not the registry that holds them.
describe("built-in derived key shapes", () => {
  beforeEach(() => {
    clearDerivedKeys();
  });
  afterEach(() => {
    clearDerivedKeys();
  });

  it("v.missionTimeHours converts seconds to hours", () => {
    registerBuiltinDerivedKeys();

    const def = getDerivedKeys().find((d) => d.id === "v.missionTimeHours");
    if (!def) throw new Error("v.missionTimeHours not registered");
    const result = def.fn([{ t: 1000, v: 3600 }], null);
    expect(result).toBe(1);
  });

  it("v.altitudeRate returns undefined on first sample", () => {
    registerBuiltinDerivedKeys();

    const def = getDerivedKeys().find((d) => d.id === "v.altitudeRate");
    if (!def) throw new Error("v.altitudeRate not registered");
    expect(def.fn([{ t: 1000, v: 0 }], null)).toBeUndefined();
  });

  it("v.altitudeRate computes m/s correctly", () => {
    registerBuiltinDerivedKeys();

    const def = getDerivedKeys().find((d) => d.id === "v.altitudeRate");
    if (!def) throw new Error("v.altitudeRate not registered");
    // 100m gained in 2 seconds = 50 m/s
    const result = def.fn([{ t: 3000, v: 200 }], [{ t: 1000, v: 100 }]);
    expect(result).toBe(50);
  });

  it("v.altitudeRate returns undefined when dt === 0", () => {
    registerBuiltinDerivedKeys();

    const def = getDerivedKeys().find((d) => d.id === "v.altitudeRate");
    if (!def) throw new Error("v.altitudeRate not registered");
    expect(
      def.fn([{ t: 1000, v: 200 }], [{ t: 1000, v: 100 }]),
    ).toBeUndefined();
  });
});
