import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { installFixedSizeResizeObserver } from "../testing";
import { Graph } from "./Graph";

const X = [0, 1, 2, 3];

describe("a graph with a legend column beside the plot", () => {
  it("draws the right axis title left of the legend chips, at any chart width", () => {
    const overlaps: string[] = [];
    for (const width of [640, 760, 880, 1100]) {
      const uninstall = installFixedSizeResizeObserver({ width, height: 180 });
      const { container, unmount } = render(
        <Graph
          chrome="bare"
          crosshair={false}
          xDomain={[0, 3]}
          xKind="value"
          yAxisLabel="Altitude"
          ySecondaryAxisLabel="Surface speed"
          series={[
            {
              id: "alt",
              label: "Altitude (above terrain)",
              axis: "primary",
              color: "#4fc3f7",
              data: { x: X, y: [0, 1, 2, 3] },
            },
            {
              id: "spd",
              label: "Surface speed",
              axis: "secondary",
              color: "#ffb74d",
              data: { x: X, y: [0, 10, 20, 30] },
            },
          ]}
        />,
      );
      const title = container.querySelector('[data-axis-title="y2"]');
      const chips = [...container.querySelectorAll('rect[height="13"]')];
      const titleX = Number(title?.getAttribute("x"));
      const chipLeft = Math.min(
        ...chips.map((c) => Number(c.getAttribute("x"))),
      );
      if (chips.length === 0 || !(titleX + 7 <= chipLeft)) {
        overlaps.push(`${width}px: title at ${titleX}, chips from ${chipLeft}`);
      }
      unmount();
      uninstall();
    }
    expect(overlaps).toEqual([]);
  });
});
