import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { RECKONING_MARK } from "./reckoningMarkSpec";
import { VESSEL_MARK, VesselMarkSvg } from "./vesselMark";

function mark(state?: "current" | "held" | "modelled") {
  const { container } = render(
    <svg aria-hidden="true">
      <VesselMarkSvg x={100} y={50} r={10} state={state} />
    </svg>,
  );
  return {
    group: container.querySelector("[data-vessel-mark]"),
    shape: container.querySelector("polygon"),
    ring: container.querySelector("circle"),
  };
}

/** The shape's corners as numbers, which are relative to the point the group is moved to. */
function corners(shape: Element | null): number[][] {
  return (shape?.getAttribute("points") ?? "")
    .split(" ")
    .map((pair) => pair.split(",").map(Number))
    .map(([x, y]) => [x, y]);
}

describe("VesselMarkSvg", () => {
  it("draws a current vessel as the five-cornered shape alone, point up, in the vessel's green", () => {
    const { group, shape, ring } = mark();
    expect(group).toHaveAttribute("data-vessel-mark", "current");
    expect(group).toHaveAttribute("transform", "translate(100 50)");
    expect(ring).toBeNull();
    expect(shape).toHaveAttribute("fill", "var(--color-accent-fg)");
    const points = corners(shape);
    expect(points).toHaveLength(5);
    // One corner alone on the centre line, above every other: the point.
    const top = Math.min(...points.map(([, y]) => y));
    expect(points.filter(([, y]) => y === top)).toEqual([[0, top]]);
  });

  it("stays close to the size of the dot it replaced: narrower, and a little taller for the point", () => {
    for (const [x, y] of corners(mark().shape)) {
      expect(Math.abs(x)).toBeLessThanOrEqual(10);
      expect(Math.abs(y)).toBeLessThanOrEqual(11.5);
    }
  });

  it("rings a held vessel with a dashed ring in the held hue, the shape shrunk inside it", () => {
    const { shape, ring } = mark("held");
    expect(ring).toHaveAttribute("stroke", RECKONING_MARK.held.color);
    expect(ring).toHaveAttribute("stroke-dasharray");
    expect(ring).toHaveAttribute("fill", "none");
    expect(shape).toHaveAttribute("fill", "var(--color-accent-fg)");
    const inner = Number(ring?.getAttribute("r")) - 10 * VESSEL_MARK.ringWidth;
    for (const [x, y] of corners(shape)) {
      expect(Math.hypot(x, y)).toBeLessThan(inner);
    }
  });

  it("rings a modelled vessel with a solid ring in the modelled hue", () => {
    const { shape, ring } = mark("modelled");
    expect(ring).toHaveAttribute("stroke", RECKONING_MARK.modelled.color);
    expect(ring).not.toHaveAttribute("stroke-dasharray");
    expect(shape).toHaveAttribute("fill", "var(--color-accent-fg)");
  });

  it("dashes the held ring into whole dashes, so no dash is cut where the ring closes", () => {
    const [dash, gap] = VESSEL_MARK.heldDash;
    const count = (2 * Math.PI * VESSEL_MARK.ringRadius) / (dash + gap);
    expect(count).toBeCloseTo(Math.round(count), 1);
  });
});
