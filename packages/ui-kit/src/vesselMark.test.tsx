import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { RECKONING_MARK } from "./reckoningMarkSpec";
import { VESSEL_MARK, VesselMarkSvg } from "./vesselMark";

const GREEN = "var(--color-accent-fg)";

function mark(state?: "current" | "held" | "modelled" | "lost") {
  const { container } = render(
    <svg aria-hidden="true">
      <VesselMarkSvg x={100} y={50} r={10} state={state} />
    </svg>,
  );
  return {
    group: container.querySelector("[data-vessel-mark]"),
    circle: container.querySelector("circle"),
    shape: container.querySelector("polygon"),
  };
}

/** The shape's corners as numbers, which are relative to the point the group is moved to. */
function corners(shape: Element | null): number[][] {
  return (shape?.getAttribute("points") ?? "")
    .split(" ")
    .map((pair) => pair.split(",").map(Number));
}

describe("VesselMarkSvg", () => {
  it("draws a current vessel as a circle in the vessel's green, at the point it is given", () => {
    const { group, circle, shape } = mark();
    expect(group).toHaveAttribute("data-vessel-mark", "current");
    expect(group).toHaveAttribute("transform", "translate(100 50)");
    expect(circle).toHaveAttribute("r", "10");
    expect(circle).toHaveAttribute("fill", GREEN);
    expect(shape).toBeNull();
  });

  it("draws a held vessel as a square in the held hue, outlined in the vessel's green", () => {
    const { circle, shape } = mark("held");
    expect(circle).toBeNull();
    expect(shape).toHaveAttribute("fill", RECKONING_MARK.held.color);
    expect(shape).toHaveAttribute("stroke", GREEN);
    const points = corners(shape);
    expect(points).toHaveLength(4);
    // Four corners equally far out on both axes: a square, and an upright one.
    for (const [x, y] of points) {
      expect(Math.abs(x)).toBeCloseTo(10 * VESSEL_MARK.squareHalf, 6);
      expect(Math.abs(y)).toBeCloseTo(10 * VESSEL_MARK.squareHalf, 6);
    }
  });

  it("draws a modelled vessel as a triangle, point up, in the modelled hue, outlined in the vessel's green", () => {
    const { circle, shape } = mark("modelled");
    expect(circle).toBeNull();
    expect(shape).toHaveAttribute("fill", RECKONING_MARK.modelled.color);
    expect(shape).toHaveAttribute("stroke", GREEN);
    const points = corners(shape);
    expect(points).toHaveLength(3);
    // One corner alone on the centre line, above the other two: the point.
    const top = Math.min(...points.map(([, y]) => y));
    expect(points.filter(([, y]) => y === top)).toEqual([[0, top]]);
  });

  it("keeps the held and modelled shapes to the footprint of the current circle", () => {
    for (const state of ["held", "modelled"] as const) {
      const outline = (10 * VESSEL_MARK.outlineWidth) / 2;
      for (const [x, y] of corners(mark(state).shape)) {
        expect(Math.hypot(x, y) + outline).toBeLessThanOrEqual(
          10 * VESSEL_MARK.reach + 1,
        );
        expect(Math.abs(x) + outline).toBeLessThanOrEqual(12.1);
      }
    }
  });

  it("draws a lost vessel as the square emptied, its outline in the no-go hue", () => {
    const { circle, shape } = mark("lost");
    expect(circle).toBeNull();
    expect(corners(shape)).toHaveLength(4);
    expect(shape).toHaveAttribute("fill", "none");
    expect(shape).toHaveAttribute("stroke", "var(--color-nogo-mark)");
  });

  it("reaches as far as its farthest corner and half the outline round it, so two marks a reach apart do not touch", () => {
    for (const state of ["held", "modelled", "lost"] as const) {
      for (const [x, y] of corners(mark(state).shape)) {
        expect(
          Math.hypot(x, y) + (10 * VESSEL_MARK.outlineWidth) / 2,
        ).toBeLessThanOrEqual(10 * VESSEL_MARK.reach + 1e-9);
      }
    }
  });

  it("tells the three states apart by shape alone and by hue alone", () => {
    const shapes = (["current", "held", "modelled"] as const).map((state) => {
      const { circle, shape } = mark(state);
      return {
        sides: circle ? 0 : corners(shape).length,
        fill: (circle ?? shape)?.getAttribute("fill"),
      };
    });
    expect(new Set(shapes.map((s) => s.sides)).size).toBe(3);
    expect(new Set(shapes.map((s) => s.fill)).size).toBe(3);
  });
});

describe("the vessel mark's keyline", () => {
  function keylined(state: "current" | "held" | "modelled", keyline: boolean) {
    const { container } = render(
      <svg aria-hidden="true">
        <VesselMarkSvg x={0} y={0} r={10} state={state} keyline={keyline} />
      </svg>,
    );
    return container.querySelector("[data-vessel-keyline]");
  }

  it("draws none unless asked, so a mark on a flat ground is what it was", () => {
    for (const state of ["current", "held", "modelled"] as const) {
      expect(keylined(state, false)).toBeNull();
    }
  });

  it("draws a white outline blended by difference under the mark, so it is the inverse of the ground", () => {
    for (const state of ["current", "held", "modelled"] as const) {
      const keyline = keylined(state, true);
      expect(keyline).toHaveAttribute("stroke", "rgb(255 255 255)");
      expect(keyline).toHaveAttribute("fill", "none");
      expect(keyline).toHaveStyle({ mixBlendMode: "difference" });
      // Under the mark: the first thing drawn in the group.
      expect(keyline?.parentElement?.firstElementChild).toBe(keyline);
    }
  });

  it("shows the same width of keyline beyond a current circle as beyond an outlined shape", () => {
    const beyond = (state: "current" | "held") => {
      const stroke = Number(
        keylined(state, true)?.getAttribute("stroke-width"),
      );
      const outline = state === "current" ? 0 : 10 * VESSEL_MARK.outlineWidth;
      return (stroke - outline) / 2;
    };
    expect(beyond("current")).toBeCloseTo(10 * VESSEL_MARK.keylineWidth, 6);
    expect(beyond("held")).toBeCloseTo(10 * VESSEL_MARK.keylineWidth, 6);
  });
});
