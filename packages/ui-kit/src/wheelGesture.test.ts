import { describe, expect, it } from "vitest";
import { createWheelGesture, wheelZoomFactor } from "./wheelGesture";

/** Events every `gap` ms from `start`, `count` of them, all with the pointer `inside` or not. */
function run(
  g: ReturnType<typeof createWheelGesture>,
  start: number,
  gap: number,
  count: number,
  pointerInside: (i: number) => boolean,
) {
  return Array.from({ length: count }, (_, i) =>
    g.wheel(start + i * gap, pointerInside(i)),
  );
}

describe("wheel gesture ownership", () => {
  it("gives a gesture that starts inside the diagram to the diagram", () => {
    const g = createWheelGesture();
    expect(run(g, 0, 16, 10, () => true)).toEqual(Array(10).fill("diagram"));
  });

  it("keeps a page scroll with the page when the pointer crosses into the diagram", () => {
    const g = createWheelGesture();
    const owners = run(g, 0, 16, 20, (i) => i >= 8);
    expect(new Set(owners)).toEqual(new Set(["page"]));
  });

  it("keeps a gesture that began inside with the diagram when the pointer leaves", () => {
    const g = createWheelGesture();
    const owners = run(g, 0, 16, 20, (i) => i < 8);
    expect(new Set(owners)).toEqual(new Set(["diagram"]));
  });

  it("holds one gesture through inertial trackpad events with growing gaps", () => {
    const g = createWheelGesture();
    let t = 0;
    const owners = [g.wheel(t, false)];
    for (const gap of [8, 8, 12, 16, 24, 40, 60, 90, 120, 150]) {
      t += gap;
      owners.push(g.wheel(t, true));
    }
    expect(new Set(owners)).toEqual(new Set(["page"]));
  });

  it("starts a new gesture after a quiet gap, so a second turn inside zooms", () => {
    const g = createWheelGesture();
    run(g, 0, 16, 5, () => false);
    expect(g.wheel(1000, true)).toBe("diagram");
  });

  it("does not hand a slow notched page scroll to a diagram that scrolls under the pointer, however slow", () => {
    const g = createWheelGesture();
    expect(g.wheel(0, false)).toBe("page");
    g.pageScrolled();
    for (const at of [320, 900, 4000, 30_000]) {
      expect(g.wheel(at, true)).toBe("page");
      g.pageScrolled();
    }
  });

  it("lets a diagram zoom once the pointer has really moved over it after the page scrolled", () => {
    const g = createWheelGesture();
    g.pageScrolled();
    expect(g.wheel(1000, true)).toBe("page");
    g.pointerMovedInside();
    expect(g.wheel(2000, true)).toBe("diagram");
  });

  it("keeps zooming a diagram the pointer rests on, since nothing scrolled", () => {
    const g = createWheelGesture();
    g.pointerMovedInside();
    for (const at of [0, 1000, 2000, 3000])
      expect(g.wheel(at, true)).toBe("diagram");
  });

  it("hands the rest of a gesture to the page when the diagram has nothing left to zoom", () => {
    const g = createWheelGesture();
    expect(g.wheel(0, true)).toBe("diagram");
    g.yieldToPage();
    expect(g.wheel(16, true)).toBe("page");
    expect(g.wheel(1000, true)).toBe("diagram");
  });
});

describe("wheel zoom factor", () => {
  it("makes a mouse notch one 1.15 step in either direction", () => {
    expect(wheelZoomFactor(-100, 0, false)).toBeCloseTo(1.15, 6);
    expect(wheelZoomFactor(100, 0, false)).toBeCloseTo(1 / 1.15, 6);
  });

  it("scales a small pinch delta up so it follows the fingers", () => {
    expect(wheelZoomFactor(-5, 0, true)).toBeGreaterThan(
      wheelZoomFactor(-5, 0, false),
    );
  });

  it("bounds one event, so a huge line-mode delta cannot jump the view", () => {
    expect(wheelZoomFactor(-100, 1, false)).toBeLessThan(1.25);
  });
});
