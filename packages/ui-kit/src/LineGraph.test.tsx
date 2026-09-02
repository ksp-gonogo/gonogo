import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
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

  // A break is a span the chart has NO READINGS FOR. Drawn as one stroke, the
  // segment across it is a straight line an operator cannot tell from data,
  // which is the failure the whole blackout-recorder chain exists to avoid: the
  // server states the hole on `Meta.gapSinceUt`, the store carries it, the
  // series carries it as an index, and this is where it has to become visible.
  it("breaks the stroke at a break index instead of joining across it", () => {
    const { container } = render(
      <LineGraph
        series={[
          {
            ...AMBIENT,
            points: [
              { x: 0, y: 1 },
              { x: 1, y: 2 },
              { x: 10, y: 3 },
              { x: 11, y: 4 },
            ],
            breaks: [2],
          },
        ]}
        ariaLabel="Radiation trend"
      />,
    );
    // Two runs, not one line through the hole.
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
  });

  it("drops a run left with fewer than two points by a break", () => {
    const { container } = render(
      <LineGraph
        series={[{ ...AMBIENT, breaks: [1] }]}
        ariaLabel="Radiation trend"
      />,
    );
    // The break leaves a single point before it, which is not a line: only the
    // two-point run after it draws.
    expect(container.querySelectorAll("polyline")).toHaveLength(1);
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

describe("LineGraph marker threshold style", () => {
  const withMarker = (valueText?: string) =>
    render(
      <LineGraph
        series={[AMBIENT]}
        variant="sparkline"
        thresholds={[{ id: "safe", label: "Safe", value: 1.75, valueText }]}
        thresholdStyle="marker"
        ariaLabel="Radiation trend"
      />,
    );

  it("draws a fixed HTML tick instead of any in-frame threshold line", () => {
    const { container } = withMarker();
    // No SVG threshold at all: the marker is an HTML overlay so its length
    // does not stretch with the viewBox.
    expect(container.querySelector("line")).toBeNull();
    const marker = container.querySelector('[data-threshold-marker="safe"]');
    expect(marker).not.toBeNull();
  });

  it("anchors at the threshold's own height within the frame", () => {
    const { container } = withMarker();
    const marker = container.querySelector<HTMLElement>(
      '[data-threshold-marker="safe"]',
    );
    const top = Number.parseFloat(marker?.style.top ?? "");
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(100);
  });

  it("renders the valueText label beside the tick", () => {
    const { container } = withMarker("0.5");
    const marker = container.querySelector('[data-threshold-marker="safe"]');
    expect(marker?.textContent).toBe("0.5");
  });

  it("is decorative: hidden from the accessibility tree", () => {
    const { container } = withMarker("0.5");
    expect(
      container.querySelector('[data-threshold-marker="safe"]'),
    ).toHaveAttribute("aria-hidden", "true");
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
            color: "var(--color-status-warning-fg-muted)",
          },
        ]}
        thresholdStyle="marker"
        ariaLabel="Radiation trend"
      />,
    );
    const marker = container.querySelector<HTMLElement>(
      '[data-threshold-marker="safe"]',
    );
    expect(marker?.style.color).toBe("var(--color-status-warning-fg-muted)");
  });

  it("skips a threshold outside a pinned domain rather than pinning it to an edge", () => {
    const { container } = render(
      <LineGraph
        series={[AMBIENT]}
        variant="sparkline"
        yDomain={[0, 1]}
        thresholds={[{ id: "safe", label: "Safe", value: 1.75 }]}
        thresholdStyle="marker"
        ariaLabel="Radiation trend"
      />,
    );
    expect(
      container.querySelector('[data-threshold-marker="safe"]'),
    ).toBeNull();
  });
});

describe("LineGraph sparkline variant", () => {
  it("breaks the area fill at a break index too", () => {
    const { container } = render(
      <LineGraph
        variant="sparkline"
        series={[
          {
            ...AMBIENT,
            points: [
              { x: 0, y: 1 },
              { x: 1, y: 2 },
              { x: 10, y: 3 },
              { x: 11, y: 4 },
            ],
            breaks: [2],
          },
        ]}
      />,
    );
    // Two shaded runs with unshaded ground between: a fill across the gap
    // would claim the quantity had a value throughout it.
    expect(container.querySelectorAll("polygon")).toHaveLength(2);
  });

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
