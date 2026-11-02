import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { installFixedSizeResizeObserver } from "../testing";
import { Graph } from "./Graph";

const X = [0, 60, 120, 180];

describe("a titled two-axis graph in a tile only a few columns wide", () => {
  it.each([94, 100, 120, 140, 160])("at %ipx wide", (width) => {
    const uninstall = installFixedSizeResizeObserver({ width, height: 200 });
    const { container, unmount } = render(
      <Graph
        chrome="bare"
        xDomain={[0, 180]}
        xKind="time"
        yAxisLabel="Altitude (m)"
        ySecondaryAxisLabel="Orbital speed (m/s)"
        series={[
          {
            id: "alt",
            label: "Altitude",
            axis: "primary",
            color: "#4fc3f7",
            data: { x: X, y: [0, 12000, 45000, 70000] },
          },
          {
            id: "spd",
            label: "Orbital speed",
            axis: "secondary",
            color: "#ffb74d",
            data: { x: X, y: [0, 300, 1200, 2300] },
          },
        ]}
      />,
    );
    const small = container.querySelector("title")?.textContent;
    const paths = container.querySelectorAll("path").length;
    unmount();
    uninstall();
    expect(small).not.toBe("Chart too small to render");
    expect(paths).toBeGreaterThan(0);
  });
});
