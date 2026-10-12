import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { PlotCrosshair, plotCrosshairShowsCard } from "./PlotCrosshair";

const plot = { x0: 40, y0: 10, x1: 340, y1: 200 };

function mount(x: number, plotBox = plot) {
  return render(
    <svg width={400} height={240} aria-label="chart" role="img">
      <PlotCrosshair
        x={x}
        plot={plotBox}
        heading="T+30s"
        rows={[
          { id: "a", label: "Altitude", color: "red", value: "12 km", y: 80 },
          { id: "b", label: "Speed", color: "blue", value: null },
          {
            id: "c",
            label: "Mass",
            color: "green",
            value: "3 t",
            currency: "modelled",
            modelled: true,
            y: 120,
          },
        ]}
      />
    </svg>,
  );
}

describe("PlotCrosshair", () => {
  it("draws the line, a dot per located row and the null token for an absent one", () => {
    const { container } = mount(100);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
    expect(
      container.querySelector('[data-plot-crosshair-row="b"]')?.textContent,
    ).toContain("\u2014");
    expect(container.querySelector("[data-reckoning-mark]")).not.toBeNull();
  });

  it("keeps the card on the side of the line with room, inside the plot", () => {
    const left = mount(60).container.querySelector(
      "[data-plot-crosshair-card] rect",
    );
    const right = mount(330).container.querySelector(
      "[data-plot-crosshair-card] rect",
    );
    const l = Number(left?.getAttribute("x"));
    const r = Number(right?.getAttribute("x"));
    const rw = Number(right?.getAttribute("width"));
    expect(l).toBeGreaterThanOrEqual(plot.x0);
    expect(r + rw).toBeLessThanOrEqual(plot.x1);
    expect(r + rw).toBeLessThanOrEqual(330);
  });

  it("gives a small plot values only, without labels or heading", () => {
    const { container } = mount(60, { x0: 20, y0: 5, x1: 120, y1: 100 });
    const card = container.querySelector("[data-plot-crosshair-card]");
    expect(card?.textContent).not.toContain("Altitude");
    expect(card?.textContent).not.toContain("T+30s");
    expect(card?.textContent).toContain("12 km");
  });

  it("keeps an absent row's series identity on a compact card", () => {
    const { container } = mount(60, { x0: 20, y0: 5, x1: 140, y1: 100 });
    const row = container.querySelector('[data-plot-crosshair-row="b"]');
    expect(row?.querySelector("[data-plot-crosshair-swatch]")).not.toBeNull();
    expect(row?.textContent).toContain("Speed");
    expect(row?.textContent).toContain("\u2014");
  });

  it("says whether the card has room, so a chart can give up its legend", () => {
    const rows = [{ id: "a", label: "A", color: "red", value: "1" }];
    const at = { x: 60, heading: "T+1s", rows };
    expect(plotCrosshairShowsCard({ ...at, plot })).toBe(true);
    expect(
      plotCrosshairShowsCard({
        ...at,
        plot: { x0: 0, y0: 0, x1: 100, y1: 20 },
      }),
    ).toBe(false);
  });

  it("never draws the card over a dot, moving to a corner that is clear", () => {
    const rows = [
      { id: "a", label: "Altitude", color: "red", value: "12 km", y: 20 },
    ];
    const { container } = render(
      <svg width={400} height={240} aria-label="chart" role="img">
        <PlotCrosshair
          x={100}
          plot={{ x0: 20, y0: 5, x1: 120, y1: 100 }}
          heading="T+1s"
          rows={rows}
        />
      </svg>,
    );
    const card = container.querySelector("[data-plot-crosshair-card] rect");
    const top = Number(card?.getAttribute("y"));
    const height = Number(card?.getAttribute("height"));
    expect(top).toBeGreaterThan(20);
    expect(top + height).toBeLessThanOrEqual(100);
  });

  it("gives the card up when every corner would cover a dot", () => {
    const tiny = { x0: 10, y0: 5, x1: 70, y1: 100 };
    const rows = [
      { id: "a", label: "A", color: "red", value: "1", y: 12 },
      { id: "b", label: "B", color: "blue", value: "2", y: 90 },
    ];
    expect(
      plotCrosshairShowsCard({ x: 40, plot: tiny, heading: "T", rows }),
    ).toBe(false);
  });

  it("stands in a given column, naming the instant and keeping the limits, whatever the plot's size", () => {
    const small = { x0: 20, y0: 5, x1: 120, y1: 160 };
    const column = { x0: 130, y0: 5, x1: 260, y1: 160 };
    const { container } = render(
      <svg width={300} height={180} aria-label="chart" role="img">
        <PlotCrosshair
          x={60}
          plot={small}
          column={column}
          heading="T+30s"
          rows={[
            { id: "a", label: "Altitude", color: "red", value: "1", y: 40 },
            {
              id: "t",
              label: "limit",
              color: "gold",
              value: "9",
              detail: true,
            },
          ]}
        />
      </svg>,
    );
    const card = container.querySelector("[data-plot-crosshair-card]");
    const rect = card?.querySelector("rect");
    expect(Number(rect?.getAttribute("x"))).toBe(column.x0);
    expect(card?.textContent).toContain("T+30s");
    expect(card?.querySelector('[data-plot-crosshair-row="t"]')).not.toBeNull();
  });
});
