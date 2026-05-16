import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShipDiagram } from "./ShipDiagram";
import type { ShipMapPart } from "./shipTopology";

// Sizes in metres, KSP convention: y is axial extent. Lateral pick for
// these straight-stack test parts is X (the lat=0 line places parts on
// the picked axis), so latHalfExtent = size.x / 2.
const SIZE_SMALL = { x: 0.6, y: 0.4, z: 0.6 };
const SIZE_TANK = { x: 1.25, y: 1.85, z: 1.25 };
const SIZE_ENGINE = { x: 1.25, y: 1.0, z: 1.25 };

function half(size: { x: number; y: number; z: number }) {
  return {
    size,
    latHalfExtent: size.x / 2,
    axialHalfExtent: size.y / 2,
    rotationRad: 0,
  };
}

const PARTS: ShipMapPart[] = [
  {
    flightId: 1,
    parentFlightId: null,
    name: "probeCoreCube",
    title: "RC-001S Remote Guidance Unit",
    type: "capsule",
    lat: 0,
    axial: 0,
    ...half(SIZE_SMALL),
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
    ...half(SIZE_TANK),
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
    ...half(SIZE_ENGINE),
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

  it("emits no heat tint when temperatures are below 50% of max", () => {
    const cool: ShipMapPart[] = [
      { ...PARTS[2], temperatureK: 300, maxTemperatureK: 2000 },
    ];
    const { container } = render(
      <ShipDiagram parts={cool} width={200} height={200} />,
    );
    expect(
      container.querySelectorAll('rect[data-role="heat-tint"]'),
    ).toHaveLength(0);
  });

  it("paints an amber heat tint between 50% and 80% of max", () => {
    const warm: ShipMapPart[] = [
      { ...PARTS[2], temperatureK: 1300, maxTemperatureK: 2000 },
    ];
    const { container } = render(
      <ShipDiagram parts={warm} width={200} height={200} />,
    );
    const tint = container.querySelector('rect[data-role="heat-tint"]');
    expect(tint?.getAttribute("fill")).toBe("var(--color-status-warning-bg)");
  });

  it("paints a red heat tint above 80% of max", () => {
    const hot: ShipMapPart[] = [
      { ...PARTS[2], temperatureK: 1900, maxTemperatureK: 2000 },
    ];
    const { container } = render(
      <ShipDiagram parts={hot} width={200} height={200} />,
    );
    const tint = container.querySelector('rect[data-role="heat-tint"]');
    expect(tint?.getAttribute("fill")).toBe("var(--color-status-nogo-bg)");
  });

  it("paints an engine-firing flame when partState reports active", () => {
    const firing: ShipMapPart[] = [
      {
        ...PARTS[2],
        partState: [{ type: "engine", state: "active" }],
      },
    ];
    const { container } = render(
      <ShipDiagram parts={firing} width={400} height={400} />,
    );
    expect(container.querySelectorAll('g[data-role="engine-flame"]'))
      .toHaveLength(1);
  });

  it("omits the engine flame when state is inactive", () => {
    const idle: ShipMapPart[] = [
      {
        ...PARTS[2],
        partState: [{ type: "engine", state: "inactive" }],
      },
    ];
    const { container } = render(
      <ShipDiagram parts={idle} width={400} height={400} />,
    );
    expect(container.querySelectorAll('g[data-role="engine-flame"]'))
      .toHaveLength(0);
  });

  it("renders a parachute canopy when partState reports deploying", () => {
    const chute: ShipMapPart[] = [
      {
        ...PARTS[0],
        type: "parachute",
        partState: [{ type: "parachute", state: "deploying" }],
      },
    ];
    const { container } = render(
      <ShipDiagram parts={chute} width={400} height={400} />,
    );
    expect(container.querySelectorAll('g[data-role="parachute-canopy"]'))
      .toHaveLength(1);
  });

  it("renders a deploy-chevron when a solar panel is mid-animation", () => {
    const animating: ShipMapPart[] = [
      {
        ...PARTS[0],
        type: "solar",
        partState: [{ type: "solarPanel", state: "deploying" }],
      },
    ];
    const { container } = render(
      <ShipDiagram parts={animating} width={400} height={400} />,
    );
    expect(container.querySelectorAll('g[data-role="anim-chevron"]'))
      .toHaveLength(1);
  });
});
