import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { approachView, farView } from "./circles";
import { craftGeometry } from "./geometry/craft";
import type { Elements } from "./geometry/kepler";

const MU = 3.5316e12;
const orbit = (m0: number, sma = 700_000): Elements => ({
  sma,
  ecc: 0,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: m0,
  epoch: 0,
  mu: MU,
});
const geometry = craftGeometry({
  chaser: orbit(1 - 400 / 700_000),
  target: orbit(1),
  ut: 0,
  approach: { time: 60, distance: 31.5 },
  bodyRadius: 600_000,
});

const strokeWidths = (unit: number, view = farView) => {
  if (geometry === null) throw new Error("no geometry");
  const { container } = render(<div>{view(geometry, unit).svg}</div>);
  return [...container.querySelectorAll("polyline")].map((p) =>
    Number(p.getAttribute("stroke-width")),
  );
};

describe("the circles' sizes in screen pixels", () => {
  it("draw a line the same pixel width in a small circle as in a large one", () => {
    // A circle shown at a third of the size takes three times the drawn units for a pixel.
    const large = strokeWidths(2);
    const small = strokeWidths(6);
    expect(large.length).toBeGreaterThan(0);
    large.forEach((w, i) => {
      expect(small[i]).toBeCloseTo(w * 3, 6);
    });
  });

  it("scales the labels and marks the same way, so the closest-approach label stays readable", () => {
    if (geometry === null) throw new Error("no geometry");
    const label = (unit: number) => {
      const { container } = render(
        <div>{approachView(geometry, unit).svg}</div>,
      );
      return Number(container.querySelector("text")?.getAttribute("font-size"));
    };
    expect(label(6)).toBeCloseTo(label(2) * 3, 6);
    expect(label(2)).toBeGreaterThan(0);
  });

  it("dims the body in the small Far circle, so it reads as a view and not a blob", () => {
    if (geometry === null) throw new Error("no geometry");
    const opacity = (small: boolean) => {
      const { container } = render(
        <div>{farView(geometry, 3, small).svg}</div>,
      );
      return container.querySelector("circle")?.getAttribute("fill-opacity");
    };
    expect(opacity(false)).toBe("1");
    expect(Number(opacity(true))).toBeLessThan(0.6);
  });
});

describe("the drift arrow on the Approach circle", () => {
  const arrow = (
    drift: { radial: number; alongTrack: number } | null,
    small = false,
  ) => {
    if (geometry === null) throw new Error("no geometry");
    const { container } = render(
      <div>{approachView(geometry, 2, small, drift).svg}</div>,
    );
    return container.querySelector("[data-drift-arrow]");
  };

  it("is drawn while the craft is drifting", () => {
    expect(arrow({ radial: 0.2, alongTrack: 1.4 })).not.toBeNull();
  });

  it("is left out while the craft holds station, with no drift reading, and on the small circle", () => {
    expect(arrow({ radial: 0.01, alongTrack: -0.02 })).toBeNull();
    expect(arrow(null)).toBeNull();
    expect(arrow({ radial: 0.2, alongTrack: 1.4 }, true)).toBeNull();
  });

  it("points the way the craft moves: forward along the orbit is to the left, radially out is up", () => {
    const tip = (drift: { radial: number; alongTrack: number }) => {
      const el = arrow(drift)?.querySelector("line");
      return {
        dx: Number(el?.getAttribute("x2")) - Number(el?.getAttribute("x1")),
        dy: Number(el?.getAttribute("y2")) - Number(el?.getAttribute("y1")),
      };
    };
    expect(tip({ radial: 0, alongTrack: 1 }).dx).toBeLessThan(0);
    expect(tip({ radial: 1, alongTrack: 0 }).dy).toBeLessThan(0);
  });
});
