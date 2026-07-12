import type { ManeuverNode } from "@ksp-gonogo/core";
import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useManeuverNodes } from "./useManeuverNodes";

function fakeNode(
  partial: Partial<ManeuverNode> & {
    UT: number;
    deltaV: [number, number, number];
  },
): ManeuverNode {
  return {
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
    ...partial,
  };
}

function Probe({
  onRender,
}: {
  onRender: (nodes: ReturnType<typeof useManeuverNodes>) => void;
}) {
  const nodes = useManeuverNodes();
  onRender(nodes);
  return null;
}

describe("useManeuverNodes", () => {
  let mock: MockDataSource;

  beforeEach(() => {
    clearRegistry();
    mock = new MockDataSource({
      id: "data",
      keys: [{ key: "o.maneuverNodes" }],
    });
    registerDataSource(mock);
    void mock.connect();
  });

  afterEach(() => {
    cleanup();
    clearRegistry();
  });

  it("returns an empty array when no nodes are present", () => {
    const renders: Array<ReturnType<typeof useManeuverNodes>> = [];
    render(<Probe onRender={(n) => renders.push(n)} />);
    act(() => mock.emit("o.maneuverNodes", []));
    expect(renders.at(-1)).toEqual([]);
  });

  it("parses nodes and derives deltaVMagnitude + id", () => {
    const renders: Array<ReturnType<typeof useManeuverNodes>> = [];
    render(<Probe onRender={(n) => renders.push(n)} />);
    act(() =>
      mock.emit("o.maneuverNodes", [
        fakeNode({ UT: 100, deltaV: [3, 4, 0] }),
        fakeNode({ UT: 200, deltaV: [0, 0, 12] }),
      ]),
    );

    const last = renders.at(-1);
    expect(last).toHaveLength(2);
    expect(last?.[0]).toMatchObject({
      id: 0,
      UT: 100,
      deltaVMagnitude: 5,
    });
    expect(last?.[1]).toMatchObject({
      id: 1,
      UT: 200,
      deltaVMagnitude: 12,
    });
  });

  it("returns a new list when the underlying array changes", () => {
    const renders: Array<ReturnType<typeof useManeuverNodes>> = [];
    render(<Probe onRender={(n) => renders.push(n)} />);
    act(() =>
      mock.emit("o.maneuverNodes", [fakeNode({ UT: 10, deltaV: [1, 0, 0] })]),
    );
    const first = renders.at(-1);
    act(() =>
      mock.emit("o.maneuverNodes", [
        fakeNode({ UT: 10, deltaV: [1, 0, 0] }),
        fakeNode({ UT: 20, deltaV: [0, 2, 0] }),
      ]),
    );
    const second = renders.at(-1);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
    expect(second).not.toBe(first);
  });
});
