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
    // Each part renders inside its own <g> — count groups that have
    // a uid-bearing key (every projected part wraps its shape).
    const groups = container.querySelectorAll("g[style]");
    expect(groups.length).toBeGreaterThanOrEqual(PARTS.length);
    // Two parent/child edges: tank→root and engine→tank. Filter by
    // data-edge so spine/stage decoration lines don't get counted.
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
    // Highlight draws an outer ring around the matched part's body box.
    const rings = container.querySelectorAll('rect[data-role="highlight-ring"]');
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

  it("renders a graceful placeholder when the parts list is empty", () => {
    const { container } = render(
      <ShipDiagram parts={[]} width={200} height={200} />,
    );
    expect(container.textContent).toMatch(/shipmap\.ks/);
    expect(container.querySelectorAll("circle")).toHaveLength(0);
  });
});
