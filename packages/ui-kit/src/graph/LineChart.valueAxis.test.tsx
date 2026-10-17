import { act, fireEvent, render } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFixedSizeResizeObserver } from "../testing";
import { orderedByX, sampleNearest } from "./crosshairMath";
import { type ChartSeries, LineChart } from "./LineChart";

/** A craft that climbs to 30 km and comes back down: its samples are in time order, not altitude order. */
const flown: ChartSeries = {
  id: "speed",
  label: "Speed",
  axis: "primary",
  color: "#fa4",
  type: "scatter",
  format: (y) => `${y} m/s`,
  data: { x: [0, 10_000, 30_000, 10_000, 0], y: [0, 900, 2000, 400, 0] },
};
const curve: ChartSeries = {
  id: "escape",
  label: "Escape velocity",
  axis: "primary",
  color: "#f44",
  dashed: true,
  readBetween: true,
  format: (y) => `${y} m/s`,
  data: { x: [0, 20_000, 40_000], y: [3000, 2000, 1000] },
};

function chart(extra: Partial<Parameters<typeof LineChart>[0]> = {}) {
  return (
    <LineChart
      series={[flown, curve]}
      xDomain={[0, 40_000]}
      xTickFormat={(v) => `${v / 1000} km`}
      xKind="value"
      crosshair
      width={400}
      height={260}
      {...extra}
    />
  );
}

describe("a crosshair on a value axis", () => {
  it("puts a series' samples in x order, keeping ties in time order", () => {
    const ordered = orderedByX(flown);
    expect(ordered.data.x).toEqual([0, 0, 10_000, 10_000, 30_000]);
    expect(ordered.data.y).toEqual([0, 0, 900, 400, 2000]);
    expect(orderedByX(curve)).toBe(curve);
  });

  it("reads a trace only near the line, and a curve between its samples", () => {
    const sorted = orderedByX(flown);
    expect(sampleNearest(sorted, 10_200, 1200)?.y).toBe(400);
    expect(sampleNearest(sorted, 20_000, 1200)).toBeNull();
    expect(sampleNearest(curve, 10_000)?.y).toBe(2500);
    expect(sampleNearest(curve, 20_000)?.y).toBe(2000);
  });

  it("is reached from the keyboard and names the x with its unit", () => {
    const { container } = render(chart());
    const svg = container.querySelector("svg") as SVGSVGElement;
    const status = container.querySelector('[role="status"]') as HTMLElement;
    act(() => svg.focus());
    expect(status.textContent).toContain("40 km");
    fireEvent.keyDown(svg, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(svg, { key: "Home" });
    expect(status.textContent).toContain("0 km");
    expect(status.textContent).toContain("Escape velocity 3000 m/s");
    expect(container.querySelector("[data-plot-crosshair]")).not.toBeNull();
  });

  it("says no sample for a trace where the craft never was", () => {
    const { container } = render(chart());
    const svg = container.querySelector("svg") as SVGSVGElement;
    const status = container.querySelector('[role="status"]') as HTMLElement;
    act(() => svg.focus());
    fireEvent.keyDown(svg, { key: "End" });
    expect(status.textContent).toContain("Speed no sample");
  });
});

describe("a head mark", () => {
  it("is a filled dot on the newest sample, or a ring where the figure is held", () => {
    const dot = render(chart({ series: [{ ...flown, headMark: "dot" }] }));
    expect(
      dot.container.querySelector('[data-head-mark="dot"]'),
    ).not.toBeNull();
    dot.unmount();
    const ring = render(chart({ series: [{ ...flown, headMark: "ring" }] }));
    const mark = ring.container.querySelector('[data-head-mark="ring"]');
    expect(mark?.getAttribute("stroke")).toBe("#fa4");
    expect(mark?.getAttribute("fill")).not.toBe("#fa4");
  });
});

describe("axis titles", () => {
  it("draws each title the caller gives and leaves room for it", () => {
    const bare = render(chart());
    const plotOf = (c: HTMLElement) => {
      const rect = c.querySelector("svg rect") as SVGRectElement;
      return {
        x: Number(rect.getAttribute("x")),
        height: Number(rect.getAttribute("height")),
      };
    };
    const before = plotOf(bare.container);
    bare.unmount();
    const { container } = render(
      chart({ xAxisLabel: "Altitude (m)", yAxisLabel: "Speed (m/s)" }),
    );
    expect(container.querySelector('[data-axis-title="x"]')?.textContent).toBe(
      "Altitude (m)",
    );
    expect(container.querySelector('[data-axis-title="y"]')?.textContent).toBe(
      "Speed (m/s)",
    );
    const after = plotOf(container);
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.height).toBeLessThan(before.height);
  });

  it("draws none on a plot of a place", () => {
    const { container } = render(
      chart({ spatial: true, xAxisLabel: "X", yAxisLabel: "Y" }),
    );
    expect(container.querySelector("[data-axis-title]")).toBeNull();
  });

  it("fills the whole frame on a plot of a place, so the frame's corners clip it", () => {
    const { container } = render(chart({ spatial: true }));
    const rect = container.querySelector("svg rect") as SVGRectElement;
    expect(rect.getAttribute("x")).toBe("0");
    expect(rect.getAttribute("y")).toBe("0");
    expect(rect.getAttribute("width")).toBe("400");
    expect(rect.getAttribute("height")).toBe("260");
  });
});

describe("a fixed card", () => {
  const sizes = Object.getOwnPropertyDescriptors(HTMLElement.prototype);
  let restoreObserver: () => void = () => {};

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return this.hasAttribute("data-plot-card") ? 90 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return this.hasAttribute("data-plot-card") ? 44 : 0;
      },
    });
    restoreObserver = installFixedSizeResizeObserver({
      width: 400,
      height: 300,
    });
  });
  afterEach(() => {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      sizes.offsetWidth,
    );
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetHeight",
      sizes.offsetHeight,
    );
    restoreObserver();
  });

  const cardOf = (c: HTMLElement) =>
    c.querySelector("[data-plot-card]") as HTMLElement;

  it("stands in a corner clear of the curve, measured from its own size", () => {
    const falling: ChartSeries = {
      id: "p",
      label: "Pressure",
      axis: "primary",
      color: "#4af",
      data: { x: [0, 40_000], y: [100, 1] },
    };
    const { container } = render(
      chart({
        series: [falling],
        crosshair: false,
        card: <span>air</span>,
      }),
    );
    const card = cardOf(container);
    expect(card.style.visibility).toBe("visible");
    expect(card.textContent).toBe("air");
    // The curve runs top left to bottom right, so the corners it leaves open are top right and bottom left.
    const left = Number.parseFloat(card.style.left);
    const top = Number.parseFloat(card.style.top);
    expect(left > 200 === top < 100).toBe(true);
  });

  it("falls back to the next form when the first has no clear corner", () => {
    // 90 by 44 is the stub's size for any card form, so a form is told apart by its text and the stub is told to make the second smaller.
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return this.hasAttribute("data-plot-card")
          ? this.textContent === "narrow"
            ? 30
            : 340
          : 0;
      },
    });
    const { container } = render(
      chart({
        crosshair: false,
        cardForms: 2,
        card: ({ form }) => <span>{form === 0 ? "wide" : "narrow"}</span>,
      }),
    );
    const card = cardOf(container);
    expect(card.textContent).toBe("narrow");
    expect(card.style.visibility).toBe("visible");
  });

  it("is not drawn where no corner is clear", () => {
    const wall: ChartSeries = {
      id: "w",
      label: "Wall",
      axis: "primary",
      color: "#4af",
      type: "scatter",
      data: {
        x: Array.from({ length: 41 * 21 }, (_, i) => (i % 41) * 1000),
        y: Array.from({ length: 41 * 21 }, (_, i) => Math.floor(i / 41) * 5),
      },
    };
    const { container } = render(
      chart({ series: [wall], crosshair: false, card: <span>air</span> }),
    );
    expect(cardOf(container).style.visibility).toBe("hidden");
  });

  it("is not drawn on a plot too small to hold it", () => {
    const { container } = render(
      chart({ width: 120, height: 90, card: <span>air</span> }),
    );
    expect(cardOf(container)?.style.visibility ?? "hidden").toBe("hidden");
  });
});

describe("a plain measured chart", () => {
  it("draws no native tooltip, and keeps its accessible name", () => {
    const { container } = render(chart({ series: [flown] }));
    expect(container.querySelector("svg > title")).toBeNull();
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe(
      "Telemetry line chart",
    );
  });
});

describe("the fixed card against the crosshair readout", () => {
  const sizes = Object.getOwnPropertyDescriptors(HTMLElement.prototype);
  let restoreObserver: () => void = () => {};
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return this.hasAttribute("data-plot-card") ? 90 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return this.hasAttribute("data-plot-card") ? 44 : 0;
      },
    });
    restoreObserver = installFixedSizeResizeObserver({
      width: 400,
      height: 300,
    });
  });
  afterEach(() => {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      sizes.offsetWidth,
    );
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetHeight",
      sizes.offsetHeight,
    );
    restoreObserver();
  });

  const falling: ChartSeries = {
    id: "p",
    label: "Pressure",
    axis: "primary",
    color: "#4af",
    data: { x: [0, 40_000], y: [100, 1] },
  };

  it("stays up when the readout has a corner of its own, and gives way when it does not", () => {
    // Wide: the readout has room in a column beside the plot, so the card stays.
    const wide = render(
      chart({ series: [falling], width: 760, card: <span>air</span> }),
    );
    const wideSvg = wide.container.querySelector("svg") as SVGSVGElement;
    act(() => wideSvg.focus());
    const wideCard = wide.container.querySelector(
      "[data-plot-card]",
    ) as HTMLElement;
    expect(wideCard.style.visibility).toBe("visible");
    wide.unmount();

    // Small: the readout has no corner clear of the card, so the card yields while the crosshair is up and returns when it leaves.
    const small = render(
      chart({
        series: [falling],
        width: 260,
        height: 200,
        card: <span>air</span>,
      }),
    );
    const card = small.container.querySelector(
      "[data-plot-card]",
    ) as HTMLElement;
    const svg = small.container.querySelector("svg") as SVGSVGElement;
    expect(card.style.visibility).toBe("visible");
    act(() => svg.focus());
    expect(card.style.visibility).toBe("hidden");
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(card.style.visibility).toBe("visible");
  });
});
