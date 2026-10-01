import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import type { Placement, ResolvedProjection } from "./projection";
import {
  SystemDiagram,
  type SystemDiagramProps,
  type VesselOrbit,
} from "./SystemDiagram";
import type { CelestialBody } from "./useCelestialBodies";

const view = {
  zoom: 1,
  pan: { x: 0, y: 0 },
  isDragging: false,
  handlePointerDown: () => {},
  resetView: () => {},
};

function body(index: number, name: string, sma: number): CelestialBody {
  return {
    index,
    name,
    referenceBody: "Kerbin",
    semiMajorAxis: sma,
    eccentricity: 0.1,
    lan: 0,
    argumentOfPeriapsis: 0,
    inclination: 0,
    trueAnomaly: 1,
    radius: 200_000,
  } as unknown as CelestialBody;
}

const bodies = [
  body(1, "Mun", 12_000_000),
  body(2, "Minmus", 47_000_000),
  { ...body(3, "Kerbin", 0), referenceBody: "Kerbol" } as CelestialBody,
];

const vesselAt = (trueAnomaly: number): VesselOrbit => ({
  parentName: "Kerbin",
  sma: 800_000,
  ecc: 0.01,
  lan: 0,
  argPe: 0,
  inclination: 0,
  trueAnomaly,
});

describe("SystemDiagram placements", () => {
  it("re-places only the vessel's point when the vessel moves along its orbit", () => {
    let calls = 0;
    const placement: Placement = {
      place: (p) => {
        calls++;
        return p;
      },
      unplace: (p) => p,
      extent: { kind: "auto-fit-metres" },
    };
    const props: Omit<SystemDiagramProps, "vessel"> = {
      bodies,
      parentName: "Kerbin",
      projection: {
        ...placement,
        id: "t",
        frame: {} as ResolvedProjection["frame"],
        lengthsPulsate: false,
      },
      width: 400,
      height: 300,
      view,
    };
    const { rerender } = render(
      <SystemDiagram {...props} vessel={vesselAt(0.1)} />,
    );
    const afterMount = calls;
    for (let i = 1; i <= 20; i++) {
      rerender(<SystemDiagram {...props} vessel={vesselAt(0.1 + i / 10)} />);
    }
    expect(calls - afterMount).toBe(20);
  });
});
