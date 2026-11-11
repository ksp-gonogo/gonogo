import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFixedSizeResizeObserver } from "../testing";
import { type ChartSeries, LineChart } from "./LineChart";

const throttle: ChartSeries = {
  id: "throttle",
  label: "Throttle",
  axis: "primary",
  color: "#fa4",
  type: "line",
  data: { x: [0, 100, 200], y: [1, 1, 1] },
};

describe("a constant series", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installFixedSizeResizeObserver({ width: 400, height: 260 });
  });
  afterEach(() => restore());

  it("draws its value inside a band of ticks, not on a collapsed axis", () => {
    const { container } = render(
      <LineChart
        series={[throttle]}
        xDomain={[0, 200]}
        width={400}
        height={260}
      />,
    );
    const ticks = [...container.querySelectorAll("text")]
      .map((t) => Number(t.textContent))
      .filter((n) => Number.isFinite(n) && n > 0 && n < 5);
    expect(Math.min(...ticks)).toBeLessThan(1);
    expect(Math.max(...ticks)).toBeGreaterThan(1);
  });
});
