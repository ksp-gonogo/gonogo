import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFixedSizeResizeObserver } from "../testing";
import { type ChartSeries, LineChart } from "./LineChart";

/** A card of three forms whose widest is too wide for a small plot, and whose middle one only fits a column or a tall plot. */
const FORM_SIZES: Record<string, [number, number]> = {
  "form 0": [300, 54],
  "form 1": [101, 93],
  "form 2": [60, 40],
};

const series: ChartSeries[] = [
  {
    id: "a",
    label: "Circular orbit (Kerbin)",
    axis: "primary",
    color: "#4af",
    data: { x: [0, 10_000, 20_000], y: [100, 800, 400] },
  },
];

function chart(width: number, height: number) {
  return (
    <LineChart
      series={series}
      xDomain={[0, 20_000]}
      xKind="value"
      width={width}
      height={height}
      card={({ form }) => <span>{`form ${form}`}</span>}
      cardForms={3}
    />
  );
}

describe("the fixed card's form after the chart is resized", () => {
  const sizes = Object.getOwnPropertyDescriptors(HTMLElement.prototype);
  let restoreObserver: () => void = () => {};
  const sizeOfCard = (el: HTMLElement) =>
    FORM_SIZES[el.textContent ?? ""] ?? [0, 0];

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return this.hasAttribute("data-plot-card") ? sizeOfCard(this)[0] : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return this.hasAttribute("data-plot-card") ? sizeOfCard(this)[1] : 0;
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

  const settled = (c: HTMLElement) => {
    const card = c.querySelector("[data-plot-card]") as HTMLElement;
    const plot = c.querySelector("svg rect") as SVGRectElement;
    return {
      card: card?.textContent,
      visibility: card?.style.visibility,
      plotWidth: plot.getAttribute("width"),
    };
  };

  it.each([
    [260, 300, 260, 134],
    [500, 300, 260, 90],
  ])("settles as a chart first drawn at its size, going from %ix%i to %ix%i", (w0, h0, w1, h1) => {
    const fresh = render(chart(w1, h1));
    const expected = settled(fresh.container);
    fresh.unmount();
    const resized = render(chart(w0, h0));
    resized.rerender(chart(w1, h1));
    expect(settled(resized.container)).toEqual(expected);
  });
});
