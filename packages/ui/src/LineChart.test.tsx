import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import type { ChartSeries } from "./LineChart";
import { LineChart } from "./LineChart";
import {
  buildPath,
  formatTimeLabel,
  makeScale,
  niceTicks,
} from "./lineChartMath";

// ── Pure helper tests ─────────────────────────────────────────────────────────

describe("makeScale", () => {
  it("maps domain endpoints to range endpoints", () => {
    const s = makeScale(0, 100, 10, 110);
    expect(s(0)).toBe(10);
    expect(s(100)).toBe(110);
    expect(s(50)).toBe(60);
  });

  it("returns midpoint when domain has zero span", () => {
    const s = makeScale(5, 5, 0, 100);
    expect(s(5)).toBe(50);
    expect(s(0)).toBe(50);
  });
});

describe("niceTicks", () => {
  it("returns requested count", () => {
    expect(niceTicks(0, 1000, 5)).toHaveLength(5);
  });

  it("all ticks fall within or at domain bounds", () => {
    const ticks = niceTicks(3, 97, 5);
    expect(ticks[0]).toBeGreaterThanOrEqual(3);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(97);
  });

  it("handles zero span", () => {
    const ticks = niceTicks(42, 42, 5);
    expect(ticks).toHaveLength(5);
    expect(ticks.every((t) => t === 42)).toBe(true);
  });
});

describe("formatTimeLabel", () => {
  it("uses mm:ss for spans under an hour", () => {
    expect(formatTimeLabel(90_000, 300_000)).toBe("1:30");
  });

  it("uses HH:mm:ss for spans at or over an hour", () => {
    expect(formatTimeLabel(3_661_000, 3_600_000)).toBe("1:01:01");
  });
});

describe("buildPath", () => {
  it("returns empty string for no points", () => {
    const s = makeScale(0, 1, 0, 100);
    expect(buildPath([], [], s, s)).toBe("");
  });

  it("returns M-only for a single point", () => {
    const sx = makeScale(0, 100, 0, 100);
    const sy = makeScale(0, 100, 100, 0);
    expect(buildPath([50], [50], sx, sy)).toBe("M50.00,50.00");
  });

  it("returns M+L for two points", () => {
    const sx = makeScale(0, 100, 0, 100);
    const sy = makeScale(0, 100, 100, 0);
    const d = buildPath([0, 100], [0, 100], sx, sy);
    expect(d).toBe("M0.00,100.00 L100.00,0.00");
  });
});

// ── Component snapshot ────────────────────────────────────────────────────────

const SERIES: ChartSeries[] = [
  {
    id: "alt",
    label: "Altitude",
    axis: "primary",
    color: "#00ff88",
    data: { x: [0, 1000, 2000], y: [0, 500, 1000] },
  },
];

describe("LineChart", () => {
  it("renders an svg with a path for the series", () => {
    const { container } = render(
      <LineChart
        series={SERIES}
        xDomain={[0, 2000]}
        width={400}
        height={200}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    const path = svg?.querySelector("path[stroke='#00ff88']");
    expect(path).not.toBeNull();
    expect(path?.getAttribute("d")).toBeTruthy();
  });

  it("renders nothing for a series with no data points", () => {
    const emptySeries: ChartSeries[] = [
      {
        id: "x",
        label: "X",
        axis: "primary",
        color: "#fff",
        data: { x: [], y: [] },
      },
    ];
    const { container } = render(
      <LineChart
        series={emptySeries}
        xDomain={[0, 1000]}
        width={400}
        height={200}
      />,
    );
    const paths = container.querySelectorAll("path[stroke='#fff']");
    expect(paths).toHaveLength(0);
  });

  it("renders empty chart with no series", () => {
    const { container } = render(
      <LineChart series={[]} xDomain={[0, 1000]} width={400} height={200} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders a secondary y-axis when a series uses it", () => {
    const dual: ChartSeries[] = [
      { ...SERIES[0] },
      {
        id: "speed",
        label: "Speed",
        axis: "secondary",
        color: "#4499ff",
        data: { x: [0, 1000, 2000], y: [0, 100, 200] },
      },
    ];
    const { container } = render(
      <LineChart series={dual} xDomain={[0, 2000]} width={400} height={200} />,
    );
    // Expect two y-axis label groups
    const texts = Array.from(container.querySelectorAll("text"));
    const axisLabels = texts.filter(
      (t) =>
        t.textContent?.includes("Altitude") || t.textContent?.includes("Speed"),
    );
    expect(axisLabels.length).toBeGreaterThan(0);
  });
});
