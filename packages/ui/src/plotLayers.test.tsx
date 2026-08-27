import type { PlotLayer } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { LineChart } from "./LineChart";
import { closeHalfPlane, type PlotLayerFrame } from "./plotLayers";

/**
 * The `PlotLayer` renderer: what a contributed layer becomes once the host
 * has scaled it.
 *
 * The point of every assertion here is that the contributor supplied DATA and
 * nothing else. Nothing below passes a pixel in, and the checks are about the
 * host's decisions: the depth stack, the clip, the palette, and what it drops
 * when there is no room.
 */

const SIZE = { width: 420, height: 320 };

function chart(layers: PlotLayer[]) {
  return render(
    <LineChart
      series={[]}
      xDomain={[0, 100]}
      yDomainPrimary={[0, 1000]}
      layers={layers}
      ariaLabel="Test plot"
      {...SIZE}
    />,
  );
}

const drawn = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-plot-layer="${id}"]`);

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
    // The domain's origin lands on the plot's bottom-left, wherever the
    // margins put that: the layer said `{x: 0, y: 0}` and nothing more.
    expect(Number(mark.getAttribute("cx"))).toBeGreaterThan(0);
    expect(Number(mark.getAttribute("cy"))).toBeLessThan(SIZE.height);
    expect(Number(mark.getAttribute("cy"))).toBeGreaterThan(SIZE.height / 2);
  });

  it("resolves a tone to a theme token, never letting a layer name a colour", () => {
    const { container } = chart([
      { kind: "marker", id: "bad", at: { x: 10, y: 10 }, tone: "nogo" },
    ]);
    expect(drawn(container, "bad")?.getAttribute("fill")).toBe(
      "var(--color-status-nogo-bg)",
    );
  });

  it("paints context under the readings, whatever order they were contributed", () => {
    // A guest's wash must never bury another's curve, so the depth stack is by
    // KIND rather than by who registered first.
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
        ariaLabel="Test plot"
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
    // The other order draws a bow tie: two filled triangles that mean nothing,
    // and the mistake every hand-rolled version of this makes once.
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
