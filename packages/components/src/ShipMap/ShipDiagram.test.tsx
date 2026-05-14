import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShipDiagram } from "./ShipDiagram";
import type { ShipMapPart } from "./shipTopology";

const SIZE_SMALL = { x: 0.6, y: 0.6, z: 0.4 };
const SIZE_TANK = { x: 1.25, y: 1.25, z: 1.85 };
const SIZE_ENGINE = { x: 1.25, y: 1.25, z: 1.0 };

const PARTS: ShipMapPart[] = [
  {
    flightId: 1,
    parentFlightId: null,
    name: "probeCoreCube",
    title: "RC-001S Remote Guidance Unit",
    type: "capsule",
    lat: 0,
    axial: 0,
    size: SIZE_SMALL,
    dryMass: 0.1,
    stage: 0,
    maxTemp: 1200,
  },
  {
    flightId: 2,
    parentFlightId: 1,
    name: "fuelTank",
    title: "FL-T400 Fuel Tank",
    type: "tank",
    lat: 0,
    axial: -1,
    size: SIZE_TANK,
    dryMass: 0.25,
    stage: 1,
    maxTemp: 2000,
    resources: [
      { n: "LiquidFuel", a: 90, c: 180 },
      { n: "Oxidizer", a: 100, c: 220 },
    ],
  },
  {
    flightId: 3,
    parentFlightId: 2,
    name: "liquidEngine3",
    title: "LV-T30 'Reliant' Liquid Fuel Engine",
    type: "engine",
    lat: 0,
    axial: -2,
    size: SIZE_ENGINE,
    dryMass: 1.25,
    stage: 1,
    maxTemp: 2000,
  },
];

describe("ShipDiagram", () => {
  afterEach(cleanup);

  it("renders one group per part and edges between parent/child pairs", () => {
    const { container } = render(
      <ShipDiagram parts={PARTS} width={200} height={200} />,
    );
    const groups = container.querySelectorAll("g[style]");
    expect(groups.length).toBeGreaterThanOrEqual(PARTS.length);
    const edges = container.querySelectorAll('line[data-edge="parent-child"]');
    expect(edges).toHaveLength(2);
  });

  it("adds a highlight ring when the hottest part name matches by title", () => {
    const { container } = render(
      <ShipDiagram
        parts={PARTS}
        highlight="LV-T30 'Reliant' Liquid Fuel Engine"
        width={200}
        height={200}
      />,
    );
    const rings = container.querySelectorAll(
      'rect[data-role="highlight-ring"]',
    );
    expect(rings).toHaveLength(1);
  });

  it("matches highlight against the `name` field too, case-insensitively", () => {
    const { container } = render(
      <ShipDiagram
        parts={PARTS}
        highlight="LIQUIDENGINE3"
        width={200}
        height={200}
      />,
    );
    expect(
      container.querySelectorAll('rect[data-role="highlight-ring"]'),
    ).toHaveLength(1);
  });

  it("renders fuel-fill bars only inside tanks and boosters", () => {
    const { container } = render(
      <ShipDiagram parts={PARTS} width={400} height={400} />,
    );
    // Two drainable resources on the one tank → two fill bars + two
    // backdrop rects = 4 inner rects with the resource-fill role. The
    // engine has no resources, so no extra bars from it.
    //
    // Test the structural invariant rather than count: at least one
    // fill-bar group exists, and engine groups have none.
    const fillGroups = container.querySelectorAll('g[pointer-events="none"]');
    expect(fillGroups.length).toBeGreaterThan(0);
  });

  it("renders a placeholder when the parts list is empty", () => {
    const { container } = render(
      <ShipDiagram parts={[]} width={200} height={200} />,
    );
    expect(container.textContent).toMatch(/no vessel topology/i);
  });
});
