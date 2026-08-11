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

describe("LineGraph centered-marker threshold style", () => {
  const withMarker = () =>
    render(
      <LineGraph
        series={[AMBIENT]}
        variant="sparkline"
        thresholds={[{ id: "safe", label: "Safe", value: 1.75 }]}
        thresholdStyle="centered-marker"
        ariaLabel="Radiation trend"
      />,
    );

  it("draws a short segment centred in the frame instead of a full-width rule", () => {
    const { container } = withMarker();
    const marker = container.querySelector("line");
    expect(marker).not.toBeNull();
    const x1 = Number(marker?.getAttribute("x1"));
    const x2 = Number(marker?.getAttribute("x2"));
    // Centred on the 100-unit viewBox and a third of it wide: short enough
    // to read as a marker, not a rule across the graph.
    expect((x1 + x2) / 2).toBeCloseTo(50);
    expect(x2 - x1).toBeCloseTo(100 / 3);
  });

  it("stays flat at the threshold's own height", () => {
    const { container } = withMarker();
    const marker = container.querySelector("line");
    const y1 = Number(marker?.getAttribute("y1"));
    const y2 = Number(marker?.getAttribute("y2"));
    expect(y1).toBe(y2);
    expect(y1).toBeGreaterThan(0);
    expect(y1).toBeLessThan(40);
  });

  it("renders solid and round-capped, never dashed", () => {
    const { container } = withMarker();
    const marker = container.querySelector("line");
    expect(marker).not.toHaveAttribute("stroke-dasharray");
    expect(marker).toHaveAttribute("stroke-linecap", "round");
  });

  it("takes the threshold's own colour so the tone carries the severity", () => {
    const { container } = render(
      <LineGraph
        series={[AMBIENT]}
        variant="sparkline"
        thresholds={[
          {
            id: "safe",
            label: "Safe",
            value: 1.75,
            color: "var(--color-status-warning-bg)",
          },
        ]}
        thresholdStyle="centered-marker"
        ariaLabel="Radiation trend"
      />,
    );
    expect(container.querySelector("line")).toHaveAttribute(
      "stroke",
      "var(--color-status-warning-bg)",
    );
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
      expect(area).toHaveAttribute("fill-opacity", "0.12");
    }
  });

  it("draws thinner strokes than the chart variant, for a glance-read trend", () => {
    const { container: chart } = render(
      <LineGraph series={[AMBIENT]} ariaLabel="Radiation trend" />,
    );
    const chartLine = chart.querySelector("polyline");
    expect(chartLine).toHaveAttribute("stroke-width", "1.4");

    const { container: sparkline } = render(
      <LineGraph
        series={[AMBIENT]}
        variant="sparkline"
        ariaLabel="Radiation trend"
      />,
    );
    const sparklineLine = sparkline.querySelector("polyline");
    expect(sparklineLine).toHaveAttribute("stroke-width", "1");
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

  it("keeps the full-width threshold rule when no thresholdStyle is asked for", () => {
    const { container } = render(
      <LineGraph
        series={[AMBIENT]}
        variant="sparkline"
        thresholds={[{ id: "safe", label: "Safe", value: 1.75 }]}
        ariaLabel="Radiation trend"
      />,
    );
    const rule = container.querySelector('line[stroke-dasharray="2 1.5"]');
    expect(rule).toHaveAttribute("x1", "0");
    expect(rule).toHaveAttribute("x2", "100");
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
