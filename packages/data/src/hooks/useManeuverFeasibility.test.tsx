import type { ManeuverNode, StageInfo } from "@ksp-gonogo/core";
import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useManeuverFeasibility } from "./useManeuverFeasibility";

function node(ut: number, dv: number): ManeuverNode {
  return {
    UT: ut,
    deltaV: [dv, 0, 0],
    PeA: 0,
    ApA: 0,
    inclination: 0,
    eccentricity: 0,
    epoch: 0,
    period: 0,
    argumentOfPeriapsis: 0,
    sma: 0,
    lan: 0,
    maae: 0,
    referenceBody: "Kerbin",
    closestEncounterBody: null,
    orbitPatches: [],
  };
}

function stage(deltaVVac: number): StageInfo {
  return {
    stage: 0,
    stageMass: 0,
    dryMass: 0,
    fuelMass: 0,
    startMass: 0,
    endMass: 0,
    burnTime: 0,
    deltaVVac,
    deltaVASL: deltaVVac,
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
  };
}

function Probe({
  onRender,
}: {
  onRender: (f: ReturnType<typeof useManeuverFeasibility>) => void;
}) {
  const f = useManeuverFeasibility();
  onRender(f);
  return null;
}

describe("useManeuverFeasibility", () => {
  let mock: MockDataSource;

  beforeEach(() => {
    clearRegistry();
    mock = new MockDataSource({
      id: "data",
      keys: [{ key: "o.maneuverNodes" }, { key: "dv.stages" }],
    });
    registerDataSource(mock);
    void mock.connect();
  });

  afterEach(() => {
    cleanup();
    clearRegistry();
  });

  it("empty plan → allOk with zero required", () => {
    const renders: Array<ReturnType<typeof useManeuverFeasibility>> = [];
    render(<Probe onRender={(f) => renders.push(f)} />);
    act(() => {
      mock.emit("o.maneuverNodes", []);
      mock.emit("dv.stages", [stage(2000)]);
    });
    const last = renders.at(-1);
    expect(last?.allOk).toBe(true);
    expect(last?.totalRequired).toBe(0);
    expect(last?.available).toBe(2000);
  });

  it("two feasible nodes → allOk and remaining decreases", () => {
    const renders: Array<ReturnType<typeof useManeuverFeasibility>> = [];
    render(<Probe onRender={(f) => renders.push(f)} />);
    act(() => {
      mock.emit("dv.stages", [stage(2000)]);
      mock.emit("o.maneuverNodes", [node(100, 500), node(200, 500)]);
    });
    const last = renders.at(-1);
    expect(last?.allOk).toBe(true);
    expect(last?.totalRequired).toBe(1000);
    expect(last?.nodes[0].remainingDeltaV).toBe(1500);
    expect(last?.nodes[1].remainingDeltaV).toBe(1000);
  });

  it("last node goes short when cumulative ΔV exceeds available", () => {
    const renders: Array<ReturnType<typeof useManeuverFeasibility>> = [];
    render(<Probe onRender={(f) => renders.push(f)} />);
    act(() => {
      mock.emit("dv.stages", [stage(800)]);
      mock.emit("o.maneuverNodes", [node(100, 500), node(200, 500)]);
    });
    const last = renders.at(-1);
    expect(last?.anyShort).toBe(true);
    expect(last?.nodes[0].ok).toBe(true);
    expect(last?.nodes[1].ok).toBe(false);
  });

  it("sorts by UT so feasibility reflects execution order", () => {
    const renders: Array<ReturnType<typeof useManeuverFeasibility>> = [];
    render(<Probe onRender={(f) => renders.push(f)} />);
    act(() => {
      mock.emit("dv.stages", [stage(800)]);
      // Emit out of UT order — the hook should sort.
      mock.emit("o.maneuverNodes", [node(200, 500), node(100, 500)]);
    });
    const last = renders.at(-1);
    expect(last?.nodes.map((n) => n.node.UT)).toEqual([100, 200]);
  });

  it("returns ok=null when ΔV telemetry is absent", () => {
    const renders: Array<ReturnType<typeof useManeuverFeasibility>> = [];
    render(<Probe onRender={(f) => renders.push(f)} />);
    act(() => {
      mock.emit("o.maneuverNodes", [node(100, 500)]);
      // Never emit dv.stages — useVesselDeltaV returns totalVac=0.
    });
    const last = renders.at(-1);
    expect(last?.nodes[0].ok).toBeNull();
    expect(last?.allOk).toBe(false);
    expect(last?.anyShort).toBe(false);
  });
});
