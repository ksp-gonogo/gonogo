import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFixedSizeResizeObserver } from "../testing";
import { type ChartSeries, LineChart } from "./LineChart";

const HEIGHT = 240;

function series(data: ChartSeries["data"]): ChartSeries {
  return {
    id: "alt",
    label: "Altitude",
    axis: "primary",
    color: "#4af",
    format: (y) => `${y} m`,
    data,
  };
}

function draw(s: ChartSeries) {
  return render(
    <LineChart
      series={[s]}
      xDomain={[0, 10]}
      xKind="value"
      width={400}
      height={HEIGHT}
    />,
  ).container;
}

function strokedYs(container: HTMLElement): number[] {
  const ys: number[] = [];
  for (const path of container.querySelectorAll("path[stroke='#4af']")) {
    const d = path.getAttribute("d") ?? "";
    for (const m of d.matchAll(
      /[ML](-?[\d.]+|NaN|-?Infinity),(-?[\d.]+|NaN|-?Infinity)/g,
    )) {
      ys.push(Number(m[2]));
    }
  }
  return ys;
}

describe("a line chart keeps every trace inside its frame", () => {
  let restoreObserver: () => void;
  beforeEach(() => {
    restoreObserver = installFixedSizeResizeObserver({
      width: 400,
      height: HEIGHT,
    });
  });
  afterEach(() => restoreObserver());

  it("never writes a non-finite sample into a path", () => {
    const container = draw(
      series({
        x: [0, 2, 4, 6, 8],
        y: [1, 2, Number.NaN, 3, Number.POSITIVE_INFINITY],
      }),
    );
    for (const path of container.querySelectorAll("path")) {
      expect(path.getAttribute("d") ?? "").not.toMatch(/NaN|Infinity/);
    }
    for (const y of strokedYs(container)) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(HEIGHT);
    }
  });

  it("scales the axis to the model's path across a gap, not only the samples", () => {
    const container = draw(
      series({
        x: [0, 4, 8],
        y: [10, 20, 10],
        bridges: [
          { to: 2, t: [5, 6, 7], v: [500, 900, 500], basis: "orbit" },
        ] as never,
      }),
    );
    const ys = strokedYs(container);
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(HEIGHT);
    }
  });

  it("clips the traces to the plot rectangle", () => {
    const container = draw(series({ x: [0, 5, 10], y: [1, 2, 3] }));
    const path = container.querySelector("path[stroke='#4af']");
    expect(path?.closest("g[clip-path]")).not.toBeNull();
  });

  it("does not stretch rounding noise over the full height of a flat series", () => {
    const flat = 69.64834;
    const container = draw(
      series({
        x: [0, 1, 2, 3, 4, 5],
        y: [flat, flat + 3e-6, flat, flat + 3e-6, flat, flat + 3e-6],
      }),
    );
    const ys = strokedYs(container);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(HEIGHT / 50);
    const ticks = [...container.querySelectorAll("text")].map(
      (t) => t.textContent ?? "",
    );
    expect(ticks.some((t) => /^69\.\d{1,4}$/.test(t))).toBe(true);
    expect(ticks.some((t) => /^69\.\d{6,}$/.test(t))).toBe(false);
  });

  it("still shows a real few-metre climb at high altitude", () => {
    const base = 70_000;
    const climb = [0, 1, 2, 3, 4, 5].map((m) => base + m);
    const container = draw(series({ x: [0, 1, 2, 3, 4, 5], y: climb }));
    const ys = strokedYs(container);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(HEIGHT / 4);
  });
});
