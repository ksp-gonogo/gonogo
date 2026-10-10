import type { PlotLayer } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { LineChart } from "./LineChart";
import { closeHalfPlane, type PlotLayerFrame } from "./plotLayers";
import { RELIEF_RESOLUTION } from "./reliefGrid";

/** A contributor supplies data only; these check the host's decisions: depth stack, clip, palette, and what it drops without room. */

const SIZE = { width: 420, height: 320 };

function chart(layers: PlotLayer[]) {
  return render(
    <LineChart
      series={[]}
      xDomain={[0, 100]}
      yDomainPrimary={[0, 1000]}
      layers={layers}
      aria-label="Test plot"
      {...SIZE}
    />,
  );
}

const drawn = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-plot-layer="${id}"]`);

describe("the vessel marker shape", () => {
  it("draws the shared vessel mark, in the state the layer names", () => {
    const { container } = chart([
      {
        kind: "marker",
        id: "craft",
        at: { x: 40, y: 400 },
        shape: "vessel",
        markState: "held",
      },
    ]);
    const layer = drawn(container, "craft");
    expect(layer).not.toBeNull();
    expect(layer?.querySelector("[data-vessel-mark]")).toHaveAttribute(
      "data-vessel-mark",
      "held",
    );
  });

  it("is current when the layer names no state", () => {
    const { container } = chart([
      {
        kind: "marker",
        id: "craft",
        at: { x: 40, y: 400 },
        shape: "vessel",
      },
    ]);
    expect(
      drawn(container, "craft")?.querySelector("[data-vessel-mark]"),
    ).toHaveAttribute("data-vessel-mark", "current");
  });
});

describe("a spatial plot's dot lattice", () => {
  const dots = (gridScale?: number) => {
    const { container } = render(
      <LineChart
        series={[]}
        xDomain={[0, 100]}
        yDomainPrimary={[0, 100]}
        spatial
        gridScale={gridScale}
        aria-label="Test plot"
        {...SIZE}
      />,
    );
    return container.querySelectorAll("circle[r='1']").length;
  };

  it("spreads its dots as the scale rises and packs them as it falls, between half and twice the usual gap", () => {
    expect(dots(0.5)).toBeGreaterThan(dots(1));
    expect(dots(1)).toBeGreaterThan(dots(2));
  });

  it("leaves out the dots that fall on the ground, so the lattice is in the sky only", () => {
    const withGround = (layers: PlotLayer[]) => {
      const { container } = render(
        <LineChart
          series={[]}
          xDomain={[0, 100]}
          yDomainPrimary={[0, 100]}
          spatial
          layers={layers}
          aria-label="Test plot"
          {...SIZE}
        />,
      );
      return [...container.querySelectorAll("circle[r='1']")].map((c) =>
        Number(c.getAttribute("cy")),
      );
    };
    const sky = withGround([]);
    const ground = withGround([
      {
        kind: "region",
        id: "ground",
        side: "below",
        boundary: [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
      },
    ]);
    // Ground at half height: every dot left is above it (a smaller y on screen), and some dots went.
    expect(ground.length).toBeGreaterThan(0);
    expect(ground.length).toBeLessThan(sky.length);
    const mid = SIZE.height / 2;
    expect(Math.max(...ground)).toBeLessThanOrEqual(mid);
  });

  it("leaves out the dots that fall on a sampled relief, where nothing is missing to mark", () => {
    const { container } = render(
      <LineChart
        series={[]}
        xDomain={[0, 100]}
        yDomainPrimary={[0, 100]}
        spatial
        layers={[
          {
            kind: "relief",
            id: "terrain",
            values: [1, 2, 3, 4],
            size: 2,
            bounds: { x0: 0, y0: 0, x1: 50, y1: 100 },
          },
        ]}
        aria-label="Test plot"
        {...SIZE}
      />,
    );
    const xs = [...container.querySelectorAll("circle[r='1']")].map((c) =>
      Number(c.getAttribute("cx")),
    );
    expect(xs.length).toBeGreaterThan(0);
    // The relief covers the left half of the plot, so every dot left is in the right half.
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(SIZE.width / 2 - 1);
  });

  it("clamps the scale to half and twice the usual gap", () => {
    expect(dots(0.1)).toBe(dots(0.5));
    expect(dots(9)).toBe(dots(2));
  });
});

describe("plot layers", () => {
  it("draws one element per layer, tagged with the contributor's own id", () => {
    const { container } = chart([
      {
        kind: "series",
        id: "curve",
        points: [
          { x: 0, y: 0 },
          { x: 90, y: 900 },
        ],
      },
      { kind: "marker", id: "here", at: { x: 40, y: 400 } },
      { kind: "rule", id: "ceiling", along: "y", value: 700, label: "CEILING" },
    ]);
    expect(drawn(container, "curve")?.tagName.toLowerCase()).toBe("path");
    expect(drawn(container, "here")?.tagName.toLowerCase()).toBe("circle");
    expect(drawn(container, "ceiling")?.tagName.toLowerCase()).toBe("line");
  });

  it("scales data space to the plot rect, so a contributor never sees a pixel", () => {
    const { container } = chart([
      { kind: "marker", id: "corner", at: { x: 0, y: 0 } },
    ]);
    const mark = drawn(container, "corner") as SVGCircleElement;
    expect(Number(mark.getAttribute("cx"))).toBeGreaterThan(0);
    expect(Number(mark.getAttribute("cy"))).toBeLessThan(SIZE.height);
    expect(Number(mark.getAttribute("cy"))).toBeGreaterThan(SIZE.height / 2);
  });

  it("resolves a tone to a theme token, never letting a layer name a colour", () => {
    const { container } = chart([
      { kind: "marker", id: "bad", at: { x: 10, y: 10 }, tone: "nogo" },
    ]);
    expect(drawn(container, "bad")?.getAttribute("fill")).toBe(
      "var(--color-nogo-mark)",
    );
  });

  it("paints context under the readings, whatever order they were contributed", () => {
    // Depth is by kind, never by registration order.
    const { container } = chart([
      {
        kind: "series",
        id: "curve",
        points: [
          { x: 0, y: 0 },
          { x: 90, y: 900 },
        ],
      },
      {
        kind: "field",
        id: "haze",
        along: "y",
        stops: [
          { at: 0, intensity: 1 },
          { at: 1000, intensity: 0 },
        ],
      },
    ]);
    const all = Array.from(container.querySelectorAll("[data-plot-layer]"));
    expect(all.map((el) => el.getAttribute("data-plot-layer"))).toEqual([
      "haze",
      "curve",
    ]);
  });

  it("clips a layer to the plot rect, so a stray curve cannot escape the frame", () => {
    const { container } = chart([
      {
        kind: "series",
        id: "curve",
        points: [
          { x: 0, y: 0 },
          { x: 90, y: 900 },
        ],
      },
    ]);
    const group = drawn(container, "curve")?.closest("g[clip-path]");
    expect(group).not.toBeNull();
  });

  it("joins every layer's own clause into the chart's accessible name", () => {
    const { container } = chart([
      {
        kind: "region",
        id: "decel",
        boundary: [
          { x: 10, y: 0 },
          { x: 40, y: 1000 },
        ],
        side: "right",
        description: "right of the curve is decelerating",
      },
    ]);
    const label = container.querySelector("svg")?.getAttribute("aria-label");
    expect(label).toBe("Test plot; right of the curve is decelerating");
  });

  it("fills a hatched region with a pattern and a plain one with the tone", () => {
    const { container } = chart([
      {
        kind: "region",
        id: "unknown",
        boundary: [
          { x: 10, y: 0 },
          { x: 10, y: 1000 },
        ],
        side: "left",
        hatched: true,
      },
      {
        kind: "region",
        id: "known",
        boundary: [
          { x: 60, y: 0 },
          { x: 60, y: 1000 },
        ],
        side: "right",
      },
    ]);
    const hatched = drawn(container, "unknown");
    expect(hatched?.hasAttribute("data-hatched")).toBe(true);
    expect(hatched?.getAttribute("fill")).toMatch(/^url\(#/);
    expect(container.querySelector("pattern")).not.toBeNull();
    expect(drawn(container, "known")?.hasAttribute("data-hatched")).toBe(false);
  });

  it("adds no clause for a layer with nothing to say", () => {
    const { container } = chart([
      { kind: "marker", id: "here", at: { x: 40, y: 400 } },
    ]);
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe(
      "Test plot",
    );
  });

  it("drops layer text on a plot too small to hold it, and keeps the marks", () => {
    const { container } = render(
      <LineChart
        series={[]}
        xDomain={[0, 100]}
        yDomainPrimary={[0, 1000]}
        layers={[
          {
            kind: "caption",
            id: "urgency",
            anchor: "bottom-left",
            text: "URGENT",
            description: "URGENT, slow now",
          },
          { kind: "marker", id: "here", at: { x: 40, y: 400 } },
        ]}
        aria-label="Test plot"
        width={150}
        height={110}
      />,
    );
    expect(drawn(container, "urgency")).toBeNull();
    expect(drawn(container, "here")).not.toBeNull();
    // The reading is not lost, only the room to print it.
    expect(
      container.querySelector("svg")?.getAttribute("aria-label"),
    ).toContain("URGENT, slow now");
  });

  it("gives every chart its own gradient ids, so two on a dashboard cannot collide", () => {
    const field: PlotLayer = {
      kind: "field",
      id: "haze",
      along: "y",
      stops: [{ at: 0, intensity: 1 }],
    };
    const a = chart([field]);
    const b = chart([field]);
    const idOf = (c: HTMLElement) =>
      c.querySelector("linearGradient")?.getAttribute("id");
    expect(idOf(a.container)).not.toBe(idOf(b.container));
  });
});

describe("closeHalfPlane", () => {
  const frame = {
    plotX0: 50,
    plotX1: 400,
    plotY0: 10,
    plotY1: 300,
  } as PlotLayerFrame;

  it("returns along the far edge, END corner first, so the ring cannot cross itself", () => {
    // Closing the other way draws a self-crossing bow tie.
    const ring = closeHalfPlane(
      [
        { x: 100, y: 300 },
        { x: 200, y: 10 },
      ],
      "right",
      frame,
    );
    expect(ring.slice(-2)).toEqual([
      { x: 400, y: 10 },
      { x: 400, y: 300 },
    ]);
  });

  it("closes along whichever edge the side names", () => {
    const boundary = [
      { x: 100, y: 300 },
      { x: 200, y: 10 },
    ];
    expect(closeHalfPlane(boundary, "left", frame).slice(-2)).toEqual([
      { x: 50, y: 10 },
      { x: 50, y: 300 },
    ]);
    expect(closeHalfPlane(boundary, "above", frame).slice(-2)).toEqual([
      { x: 200, y: 10 },
      { x: 100, y: 10 },
    ]);
    expect(closeHalfPlane(boundary, "below", frame).slice(-2)).toEqual([
      { x: 200, y: 300 },
      { x: 100, y: 300 },
    ]);
  });
});

describe("open water", () => {
  const SEA: PlotLayer = {
    kind: "water",
    id: "sea",
    view: "plan",
    bounds: { x0: 10, y0: 100, x1: 90, y1: 900 },
    origin: { east: 1_000, north: 2_000 },
    gravity: 9.81,
    tone: "info",
    description: "sea around the site",
  };

  it("draws on a canvas, hidden from assistive technology with its frame, and the chart keeps one accessible description naming it once", () => {
    const { container } = chart([
      SEA,
      {
        kind: "marker",
        id: "site",
        at: { x: 50, y: 500 },
        description: "site",
      },
    ]);
    const water = drawn(container, "sea");
    expect(water?.querySelector("foreignObject")).not.toBeNull();
    expect(water).toHaveAttribute("aria-hidden", "true");
    expect(water?.querySelector("canvas")).not.toBeNull();
    const named = container.querySelectorAll("[aria-label]");
    expect(named.length).toBe(1);
    const label = named[0].getAttribute("aria-label") ?? "";
    expect(label.split("sea around the site").length - 1).toBe(1);
  });

  it("is shaded on the relief's own cells, one flat shade a cell, so the sea is as coarse as the land beside it", () => {
    const { container } = chart([SEA]);
    const canvas = drawn(container, "sea")?.querySelector("canvas");
    expect(canvas?.width).toBe(RELIEF_RESOLUTION);
    expect(canvas?.height).toBe(RELIEF_RESOLUTION);
    expect(canvas?.style.imageRendering).toBe("pixelated");
  });

  it("is drawn over the ground and under every mark", () => {
    const { container } = chart([
      { kind: "marker", id: "site", at: { x: 50, y: 500 } },
      SEA,
      {
        kind: "region",
        id: "ground",
        side: "below",
        boundary: [
          { x: 0, y: 300 },
          { x: 100, y: 300 },
        ],
      },
    ]);
    const order = [...container.querySelectorAll("[data-plot-layer]")].map(
      (n) => n.getAttribute("data-plot-layer"),
    );
    expect(order.indexOf("ground")).toBeLessThan(order.indexOf("sea"));
    expect(order.indexOf("sea")).toBeLessThan(order.indexOf("site"));
  });
});
