import { describe, expect, it } from "vitest";
import {
  DOCK_LINED_UP_DEG,
  dockMarkGeometry,
  dockMarkPath,
  dockMarkStyles,
} from "./dock-markers";

const base = { visible: true, ax: 0.5, ay: 3, aligned: true, docked: false };

describe("dockMarkStyles", () => {
  it("leaves all four out unless the port is visible", () => {
    const s = dockMarkStyles({ ...base, visible: false });
    expect(Object.values(s).every((m) => m.hidden === true)).toBe(true);
  });

  it("colours each axis by its own angle", () => {
    const s = dockMarkStyles(base);
    expect(s.left.colour).toBe("var(--color-accent-fg)");
    expect(s.right.colour).toBe("var(--color-accent-fg)");
    expect(s.top.colour).toBe("var(--color-warn-mark)");
    expect(s.bottom.colour).toBe("var(--color-warn-mark)");
  });

  it("reads the limit as lined up", () => {
    const s = dockMarkStyles({ ...base, ax: DOCK_LINED_UP_DEG, ay: -1 });
    expect(s.top.colour).toBe("var(--color-accent-fg)");
  });

  it("outlines every triangle while the ports do not face each other", () => {
    const s = dockMarkStyles({ ...base, aligned: false });
    expect(s.top.dashed).toBe(true);
    expect(dockMarkStyles(base).top.dashed).toBe(false);
  });

  it("leaves an axis out while its angle is not reported", () => {
    const s = dockMarkStyles({ ...base, ax: undefined });
    expect(s.left.hidden).toBe(true);
    expect(s.top.hidden).toBeUndefined();
  });

  it("is green and filled on every side once docked", () => {
    const s = dockMarkStyles({
      ...base,
      ax: 20,
      ay: 20,
      docked: true,
      aligned: false,
    });
    for (const m of Object.values(s)) {
      expect(m).toEqual({ colour: "var(--color-accent-fg)", dashed: false });
    }
  });
});

describe("dockMarkGeometry", () => {
  it("keeps the camera floors on a small port", () => {
    const g = dockMarkGeometry({ x: 5, y: 6 }, 3);
    expect(g).toEqual({ cx: 5, cy: 6, half: 14, arm: 8.4, stroke: 2 });
  });

  it("sizes the box and the triangle from the apparent radius", () => {
    const g = dockMarkGeometry({ x: 0, y: 0 }, 50);
    expect(g.half).toBe(50);
    expect(g.arm).toBeCloseTo(30);
  });
});

describe("dockMarkPath", () => {
  it("draws each triangle outside the box with its tip on the edge", () => {
    const g = { cx: 100, cy: 100, half: 20, arm: 10, stroke: 2 };
    expect(dockMarkPath("top", g)).toBe("M100 80L95 72L105 72Z");
    expect(dockMarkPath("right", g)).toBe("M120 100L128 95L128 105Z");
    expect(dockMarkPath("bottom", g)).toBe("M100 120L105 128L95 128Z");
    expect(dockMarkPath("left", g)).toBe("M80 100L72 105L72 95Z");
  });
});
