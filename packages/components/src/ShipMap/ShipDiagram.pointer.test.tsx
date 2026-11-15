import { fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { Profiler } from "react";
import { describe, expect, it } from "vitest";
import { ShipDiagram } from "./ShipDiagram";
import type { ShipMapPart } from "./shipTopology";

const SIZE = { x: 1.25, y: 1.85, z: 1.25 };
const PARTS: ShipMapPart[] = [
  {
    flightId: 1,
    parentFlightId: null,
    name: "fuelTank",
    title: "FL-T400 Fuel Tank",
    type: "tank",
    lat: 0,
    axial: 0,
    size: SIZE,
    depth: 0,
    latHalfExtent: SIZE.x / 2,
    axialHalfExtent: SIZE.y / 2,
    rotationRad: 0,
    dryMass: 0.25,
    stage: 0,
    maxTemp: 2000,
  },
];

/** The pointer is only the tooltip's position, so moving it over empty space must not draw the craft again. */
describe("ShipDiagram pointer", () => {
  it("does not render on a mouse move while no part is hovered", () => {
    let commits = 0;
    render(
      <Profiler id="ship" onRender={() => commits++}>
        <ShipDiagram parts={PARTS} width={300} height={300} />
      </Profiler>,
    );
    const viewport = screen.getByLabelText("Ship diagram view");
    const before = commits;
    for (let i = 0; i < 20; i++) {
      fireEvent.mouseMove(viewport, { clientX: i, clientY: i });
    }
    expect(commits).toBe(before);
  });
});
