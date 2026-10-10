import { act, fireEvent, render } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { sampleNearest, sampleTimes, stepTime } from "./crosshairMath";
import { type ChartSeries, LineChart } from "./LineChart";

const altitude: ChartSeries = {
  id: "alt",
  label: "Altitude",
  axis: "primary",
  color: "#4af",
  format: (y) => `${y} m`,
  data: {
    x: [0, 10, 20, 30, 40],
    y: [100, 200, 300, 400, 500],
    breaks: [3],
    reckoned: [{ from: 4, to: 4, basis: "linear-dead-reckoning" }],
  },
};
const speed: ChartSeries = {
  id: "spd",
  label: "Speed",
  axis: "primary",
  color: "#fa4",
  format: (y) => `${y} m/s`,
  data: { x: [20, 30, 40], y: [5, 6, 7] },
};

function chart(extra: Partial<Parameters<typeof LineChart>[0]> = {}) {
  return (
    <LineChart
      series={[altitude, speed]}
      xDomain={[0, 40]}
      xTickFormat={(v) => `T+${v}s`}
      crosshair
      width={400}
      height={240}
      {...extra}
    />
  );
}

describe("crosshairMath", () => {
  it("reads the nearest sample and never one across a declared hole", () => {
    expect(sampleNearest(altitude, 11)?.y).toBe(200);
    expect(sampleNearest(altitude, 20)?.y).toBe(300);
    expect(sampleNearest(altitude, 24)).toBeNull();
    expect(sampleNearest(altitude, 25)).toBeNull();
  });

  it("reads nothing outside a series' extent", () => {
    expect(sampleNearest(speed, 5)).toBeNull();
    expect(sampleNearest(speed, 20)?.y).toBe(5);
  });

  it("names a modelled sample as modelled", () => {
    expect(sampleNearest(altitude, 40)?.currency).toBe("modelled");
    expect(sampleNearest(altitude, 0)?.currency).toBe("measured");
  });

  it("steps through the union of sample times and holds at the ends", () => {
    const times = sampleTimes([altitude, speed]);
    expect(times).toEqual([0, 10, 20, 30, 40]);
    expect(stepTime(times, 10, 1)).toBe(20);
    expect(stepTime(times, 10, -1)).toBe(0);
    expect(stepTime(times, 0, -1)).toBe(0);
    expect(stepTime(times, 15, 1)).toBe(20);
    expect(stepTime(times, 15, -1)).toBe(10);
    expect(stepTime(times, null, 0)).toBe(40);
  });
});

describe("LineChart crosshair", () => {
  it("is off unless asked for, and adds no tab stop", () => {
    const { container } = render(chart({ crosshair: false }));
    expect(container.querySelector("svg")?.getAttribute("tabindex")).toBeNull();
    expect(container.querySelector("[data-plot-crosshair]")).toBeNull();
  });

  it("is operable from the keyboard and announces the reading once per move", async () => {
    const { container } = render(chart());
    const svg = container.querySelector("svg") as SVGSVGElement;
    const status = container.querySelector('[role="status"]') as HTMLElement;
    act(() => svg.focus());
    expect(status.textContent).toContain("Altitude 500 m, modelled");
    expect(status.textContent).toContain("Speed 7 m/s");
    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(status.textContent).toContain("T+30s");
    expect(status.textContent).toContain("Altitude 400 m");
    fireEvent.keyDown(svg, { key: "Home" });
    expect(status.textContent).toContain("T+0s");
    expect(status.textContent).toContain("Speed no sample");
    expect(container.querySelector("[data-plot-crosshair]")).not.toBeNull();
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(container.querySelector("[data-plot-crosshair]")).toBeNull();
    expect(status.textContent).toBe("");
  });

  it("writes an absent sample as the null token, never as a number", () => {
    const { container } = render(chart());
    const svg = container.querySelector("svg") as SVGSVGElement;
    act(() => svg.focus());
    fireEvent.keyDown(svg, { key: "Home" });
    const row = container.querySelector('[data-plot-crosshair-row="spd"]');
    expect(row?.textContent).toContain("\u2014");
    expect(row?.textContent).not.toMatch(/\b0\b/);
  });

  it("follows the pointer and leaves on pointer leave", () => {
    const { container } = render(chart());
    const svg = container.querySelector("svg") as SVGSVGElement;
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 240 }) as DOMRect;
    fireEvent.pointerMove(svg, { clientX: 200, clientY: 100 });
    expect(container.querySelector("[data-plot-crosshair]")).not.toBeNull();
    fireEvent.pointerLeave(svg);
    expect(container.querySelector("[data-plot-crosshair]")).toBeNull();
  });

  it("shows no card on a plot too small for one but keeps the line", () => {
    const { container } = render(chart({ width: 90, height: 60 }));
    const svg = container.querySelector("svg") as SVGSVGElement;
    act(() => svg.focus());
    expect(
      container.querySelector("[data-plot-crosshair] line"),
    ).not.toBeNull();
    expect(container.querySelector("[data-plot-crosshair-card]")).toBeNull();
  });

  it("has no accessibility violations with the crosshair open", async () => {
    const { container } = render(chart());
    const svg = container.querySelector("svg") as SVGSVGElement;
    act(() => svg.focus());
    await expectNoA11yViolations(container);
  });

  it("hands the legend's corner to the card while the card is drawn", () => {
    const { container } = render(chart());
    const svg = container.querySelector("svg") as SVGSVGElement;
    const legendChips = () => container.querySelectorAll('rect[rx="2"]').length;
    expect(legendChips()).toBe(2);
    act(() => svg.focus());
    expect(
      container.querySelector("[data-plot-crosshair-card]"),
    ).not.toBeNull();
    expect(legendChips()).toBe(0);
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(legendChips()).toBe(2);
  });

  it("gives a roomy chart a column past the plot for its legend and card", () => {
    const { container } = render(chart({ width: 700, height: 260 }));
    const svg = container.querySelector("svg") as SVGSVGElement;
    const plotRight = () => {
      const plot = container.querySelector("svg rect") as SVGRectElement;
      return (
        Number(plot.getAttribute("x")) + Number(plot.getAttribute("width"))
      );
    };
    const chip = container.querySelector('rect[rx="2"]') as SVGRectElement;
    expect(Number(chip.getAttribute("x"))).toBeGreaterThan(plotRight());
    act(() => svg.focus());
    const card = container.querySelector(
      "[data-plot-crosshair-card] rect",
    ) as SVGRectElement;
    expect(Number(card.getAttribute("x"))).toBeGreaterThan(plotRight());
  });
});
