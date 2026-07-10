import type { StageInfo } from "@gonogo/core";
import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useVesselDeltaV } from "./useVesselDeltaV";

function fakeStage(
  partial: Partial<StageInfo> & { stage: number; deltaVVac: number },
): StageInfo {
  return {
    stageMass: 0,
    dryMass: 0,
    fuelMass: 0,
    startMass: 0,
    endMass: 0,
    burnTime: 0,
    deltaVASL: partial.deltaVVac * 0.9,
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
    ...partial,
  };
}

function Probe({
  onRender,
}: {
  onRender: (v: ReturnType<typeof useVesselDeltaV>) => void;
}) {
  const v = useVesselDeltaV();
  onRender(v);
  return null;
}

describe("useVesselDeltaV", () => {
  let mock: MockDataSource;

  beforeEach(() => {
    clearRegistry();
    mock = new MockDataSource({ id: "data", keys: [{ key: "dv.stages" }] });
    registerDataSource(mock);
    void mock.connect();
  });

  afterEach(() => {
    cleanup();
    clearRegistry();
  });

  it("returns zero totals when no stages are present", () => {
    const renders: Array<ReturnType<typeof useVesselDeltaV>> = [];
    render(<Probe onRender={(v) => renders.push(v)} />);
    act(() => mock.emit("dv.stages", []));
    expect(renders.at(-1)).toEqual({ totalVac: 0, totalASL: 0, stages: [] });
  });

  it("sums ΔV across stages", () => {
    const renders: Array<ReturnType<typeof useVesselDeltaV>> = [];
    render(<Probe onRender={(v) => renders.push(v)} />);
    act(() =>
      mock.emit("dv.stages", [
        fakeStage({ stage: 2, deltaVVac: 1000 }),
        fakeStage({ stage: 1, deltaVVac: 500 }),
        fakeStage({ stage: 0, deltaVVac: 250 }),
      ]),
    );
    const last = renders.at(-1);
    expect(last?.totalVac).toBe(1750);
    expect(last?.totalASL).toBeCloseTo(1575, 5); // 0.9× sum
    expect(last?.stages).toHaveLength(3);
  });

  // `dv.stages` is UN-GAPPED (P4a shared-map batch) but rides an IDENTICAL
  // topic key off either transport — the new mod's `StageDeltaVEntry` uses
  // `dvVac`/`dvAsl` instead of the legacy `deltaVVac`/`deltaVASL`. Proves
  // the hook normalizes the new field names rather than silently summing
  // to NaN once a widget's `dv.stages` subscription starts riding the
  // stream (mirrors FuelStatus's `parseStages` reconciliation proof).
  it("sums ΔV across stages using the new mod StageDeltaVEntry field names", () => {
    const renders: Array<ReturnType<typeof useVesselDeltaV>> = [];
    render(<Probe onRender={(v) => renders.push(v)} />);
    act(() =>
      mock.emit("dv.stages", [
        { stage: 1, dvVac: 1200, dvAsl: 1000, dvActual: 1100 },
        { stage: 0, dvVac: 600, dvAsl: 500, dvActual: 550 },
      ]),
    );
    const last = renders.at(-1);
    expect(last?.totalVac).toBe(1800);
    expect(last?.totalASL).toBe(1500);
    expect(last?.stages).toHaveLength(2);
  });
});
