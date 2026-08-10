import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { LineGraph } from "./LineGraph";

const AMBIENT = {
  id: "ambient",
  label: "Ambient",
  color: "red",
  points: [
    { x: 0, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 1.5 },
  ],
};

const SHIELDED = {
  id: "shielded",
  label: "Shielded",
  color: "blue",
  points: [
    { x: 0, y: 0.2 },
    { x: 1, y: 0.3 },
    { x: 2, y: 0.25 },
  ],
};

describe("LineGraph", () => {
  it("draws one polyline per series with at least two points", () => {
    const { container } = render(
      <LineGraph series={[AMBIENT, SHIELDED]} ariaLabel="Radiation trend" />,
    );
    const lines = container.querySelectorAll("polyline");
    expect(lines).toHaveLength(2);
  });

  it("skips a series with fewer than two points rather than crashing", () => {
    const { container } = render(
      <LineGraph
        series={[{ ...AMBIENT, points: [{ x: 0, y: 1 }] }, SHIELDED]}
        ariaLabel="Radiation trend"
      />,
    );
    expect(container.querySelectorAll("polyline")).toHaveLength(1);
  });

  it("renders a dashed threshold line at its own value", () => {
    const { container } = render(
      <LineGraph
        series={[AMBIENT]}
        thresholds={[{ id: "safe", label: "Safe", value: 1.75 }]}
        ariaLabel="Radiation trend"
      />,
    );
    const dashed = container.querySelector('line[stroke-dasharray="2 1.5"]');
    expect(dashed).not.toBeNull();
  });

  it("is aria-hidden with no ariaLabel, role=img with one", () => {
    const { rerender, container } = render(<LineGraph series={[AMBIENT]} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");

    rerender(<LineGraph series={[AMBIENT]} ariaLabel="Radiation trend" />);
    expect(
      screen.getByRole("img", { name: "Radiation trend" }),
    ).toBeInTheDocument();
  });

  it("never throws with zero series or zero points", () => {
    expect(() => render(<LineGraph series={[]} />)).not.toThrow();
    expect(() =>
      render(<LineGraph series={[{ ...AMBIENT, points: [] }]} />),
    ).not.toThrow();
  });
});

describe("LineGraph sparkline variant", () => {
  it("area-shades under each series down to the frame's bottom edge", () => {
    const { container } = render(
      <LineGraph
        series={[AMBIENT, SHIELDED]}
        variant="sparkline"
        ariaLabel="Radiation trend"
      />,
    );
    const areas = container.querySelectorAll("polygon");
    expect(areas).toHaveLength(2);
    for (const area of areas) {
      expect(area).toHaveAttribute("fill-opacity", "0.16");
    }
  });

  it("drops the quarter gridlines a chart variant draws", () => {
    const { container: chart } = render(
      <LineGraph series={[AMBIENT]} ariaLabel="Radiation trend" />,
    );
    const chartLines = chart.querySelectorAll("line:not([stroke-dasharray])");
    expect(chartLines.length).toBeGreaterThan(0);

    const { container: sparkline } = render(
      <LineGraph
        series={[AMBIENT]}
        variant="sparkline"
        ariaLabel="Radiation trend"
      />,
    );
    const sparklineLines = sparkline.querySelectorAll(
      "line:not([stroke-dasharray])",
    );
    expect(sparklineLines).toHaveLength(0);
  });

  it("keeps the dashed threshold line and the stroked polylines on top of the fill", () => {
    const { container } = render(
      <LineGraph
        series={[AMBIENT, SHIELDED]}
        variant="sparkline"
        thresholds={[{ id: "safe", label: "Safe", value: 1.75 }]}
        ariaLabel="Radiation trend"
      />,
    );
    expect(
      container.querySelector('line[stroke-dasharray="2 1.5"]'),
    ).not.toBeNull();
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
  });

  it("skips the area for a series with fewer than two points", () => {
    const { container } = render(
      <LineGraph
        series={[{ ...AMBIENT, points: [{ x: 0, y: 1 }] }, SHIELDED]}
        variant="sparkline"
        ariaLabel="Radiation trend"
      />,
    );
    expect(container.querySelectorAll("polygon")).toHaveLength(1);
  });
});
