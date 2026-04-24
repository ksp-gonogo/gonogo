import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShipDiagram } from "./ShipDiagram";
import type { ShipMapPart } from "./shipMapScript";

const PARTS: ShipMapPart[] = [
  {
    uid: "root",
    name: "probeCoreCube",
    title: "RC-001S Remote Guidance Unit",
    mass: 0.1,
    x: 0,
    y: 0,
    z: 0,
    parent: "",
  },
  {
    uid: "tank",
    name: "fuelTank",
    title: "FL-T400 Fuel Tank",
    mass: 2.25,
    x: 0,
    y: 0,
    z: -1,
    parent: "root",
  },
  {
    uid: "engine",
    name: "liquidEngine3",
    title: "LV-T30 'Reliant' Liquid Fuel Engine",
    mass: 1.25,
    x: 0,
    y: 0,
    z: -2,
    parent: "tank",
  },
];

describe("ShipDiagram", () => {
  afterEach(cleanup);

  it("renders a circle per part and edges between parent/child pairs", () => {
    const { container } = render(
      <ShipDiagram parts={PARTS} width={200} height={200} />,
    );
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBeGreaterThanOrEqual(PARTS.length);
    const lines = container.querySelectorAll("line");
    // Two parent/child edges: tank→root and engine→tank.
    expect(lines).toHaveLength(2);
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
    // Highlight draws an outer ring (fill="none") in addition to the normal
    // filled circle. Expect exactly one fill="none" circle.
    const rings = container.querySelectorAll('circle[fill="none"]');
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
    expect(container.querySelectorAll('circle[fill="none"]')).toHaveLength(1);
  });

  it("renders a graceful placeholder when the parts list is empty", () => {
    const { container } = render(
      <ShipDiagram parts={[]} width={200} height={200} />,
    );
    expect(container.textContent).toMatch(/shipmap\.ks/);
    expect(container.querySelectorAll("circle")).toHaveLength(0);
  });
});
