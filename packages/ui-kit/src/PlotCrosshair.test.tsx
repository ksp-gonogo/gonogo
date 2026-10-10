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
    expect(plotCrosshairShowsCard(plot, rows)).toBe(true);
    expect(
      plotCrosshairShowsCard({ x0: 0, y0: 0, x1: 100, y1: 20 }, rows),
    ).toBe(false);
  });
});
