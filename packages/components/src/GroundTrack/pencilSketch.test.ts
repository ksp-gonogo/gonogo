import { afterEach, describe, expect, it } from "vitest";
import {
  coastBoostFor,
  detailFromApparentSize,
  fieldSize,
  paletteFromTheme,
  planSketch,
  REMOTE_BELOW,
  SKETCH_HEIGHT,
  SKETCH_WIDTH,
} from "./pencilSketch";

describe("paletteFromTheme", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("style");
  });

  it("reads paper, coast, frame and hatch from the theme's own roles", () => {
    const root = document.documentElement.style;
    root.setProperty("--color-surface-raised", "#101010");
    root.setProperty("--color-text-primary", "#eeeeee");
    root.setProperty("--color-text-muted", "#888888");
    root.setProperty("--color-text-faint", "#555555");
    expect(paletteFromTheme()).toEqual({
      paper: "#101010",
      coast: "#eeeeee",
      ink: "#888888",
      hatch: "#555555",
    });
  });

  it("follows another theme without any other change", () => {
    const light = {
      colors: {
        surface: { raised: "#f4f1ea" },
        text: { primary: "#111111", muted: "#3a4452", faint: "#6b7480" },
      },
    };
    expect(paletteFromTheme(light)).toEqual({
      paper: "#f4f1ea",
      coast: "#111111",
      ink: "#3a4452",
      hatch: "#6b7480",
    });
  });

  it("reads the default theme's roles when no theme is given", () => {
    document.documentElement.style.setProperty(
      "--color-text-primary",
      "#fafafa",
    );
    expect(paletteFromTheme().coast).toBe("#fafafa");
  });
});

describe("coastBoostFor", () => {
  it("leaves a map shown at the sketch's own size or larger alone", () => {
    expect(coastBoostFor(SKETCH_WIDTH)).toBe(1);
    expect(coastBoostFor(2400)).toBe(1);
  });

  it("thickens coastlines for a map shown smaller, up to three times", () => {
    expect(coastBoostFor(512)).toBe(2);
    expect(coastBoostFor(380)).toBeGreaterThan(2.5);
    expect(coastBoostFor(100)).toBe(3);
  });

  it("steps in quarters so a drag does not redraw on every pixel", () => {
    expect(coastBoostFor(870) * 4).toBeCloseTo(
      Math.round(coastBoostFor(870) * 4),
    );
  });

  it("treats an unmeasured map as full size", () => {
    expect(coastBoostFor(0)).toBe(1);
    expect(coastBoostFor(Number.NaN)).toBe(1);
  });
});

describe("detailFromApparentSize", () => {
  it("puts a speck at 0 and a moon overhead at 1", () => {
    expect(detailFromApparentSize(1e-9)).toBe(0);
    expect(detailFromApparentSize(1)).toBe(1);
  });

  it("keeps Duna and Eeloo from home under the remote line and Mun over it", () => {
    const duna = detailFromApparentSize(
      320_000 / Math.hypot(13_599_840_256, 20_726_155_264),
    );
    const eeloo = detailFromApparentSize(
      210_000 / Math.hypot(13_599_840_256, 90_118_820_000),
    );
    const mun = detailFromApparentSize(200_000 / 12_000_000);
    expect(duna).toBeLessThan(REMOTE_BELOW);
    expect(eeloo).toBeLessThan(duna);
    expect(mun).toBeGreaterThan(REMOTE_BELOW);
    // One visited step above Duna's own detail is still a remote body.
    expect(duna + 0.2).toBeLessThan(REMOTE_BELOW);
  });
});

/** A texture-like grid: smooth dark blobs on a lighter ground. */
function terrain(
  cols: number,
  rows: number,
  blobs: { x: number; y: number; r: number }[],
  bandRows?: [number, number],
): Float32Array {
  const f = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // A gentle slope keeps the ground off any single value a threshold could land on.
      let v = 0.7 + 0.25 * (x / cols);
      for (const b of blobs) {
        const d =
          Math.hypot((x - b.x * cols) / cols, (y - b.y * rows) / rows) / b.r;
        if (d < 1) v = Math.min(v, 0.15 + 0.6 * d * d);
      }
      if (bandRows && y >= bandRows[0] * rows && y < bandRows[1] * rows) {
        v = Math.min(v, 0.3);
      }
      f[y * cols + x] = v;
    }
  }
  return f;
}

function plan(
  detail: number,
  blobs: Parameters<typeof terrain>[2],
  band?: [number, number],
) {
  const { cols, rows } = fieldSize(detail);
  return planSketch(
    terrain(cols, rows, blobs, band),
    SKETCH_WIDTH,
    SKETCH_HEIGHT,
    detail,
  );
}

const wideSpan = (line: [number, number][]) => {
  const xs = line.map((p) => p[0]);
  return Math.max(...xs) - Math.min(...xs);
};

describe("planSketch", () => {
  // Half-blobs on the map's edges: a contour that closes on itself is not drawn.
  const blobs = [
    { x: 0, y: 0.45, r: 0.2 },
    { x: 1, y: 0.55, r: 0.16 },
  ];

  it("plans the same lines for the same grid", () => {
    expect(plan(0.28, blobs)).toEqual(plan(0.28, blobs));
  });

  it("outlines the blobs of a close body and draws no frame", () => {
    const p = plan(1, blobs);
    expect(p.coast.length).toBeGreaterThanOrEqual(2);
    expect(p.frame).toBeNull();
  });

  it("frames a remote body, including one a visited step above its own detail", () => {
    expect(plan(0.28, blobs).frame).not.toBeNull();
    expect(plan(0.28 + 0.2, blobs).frame).not.toBeNull();
    expect(plan(REMOTE_BELOW + 0.01, blobs).frame).toBeNull();
  });

  it("drops a remote contour that spans more than half the map, which reads as a stripe", () => {
    const withBand = plan(0.28, blobs, [0.4, 0.6]);
    for (const line of withBand.coast) {
      expect(wideSpan(line)).toBeLessThan(SKETCH_WIDTH * 0.5);
    }
  });

  it("keeps a close body's long contours", () => {
    const longBand = plan(1, [], [0.4, 0.6]);
    expect(longBand.coast.some((l) => wideSpan(l) > SKETCH_WIDTH * 0.5)).toBe(
      true,
    );
  });

  it("keeps the longest few contours of a remote body, fewer the less detail", () => {
    // Dark vertical stripes from the top edge to the bottom, each with two outlines, on a gently sloping ground.
    const stripes = (detail: number) => {
      const { cols, rows } = fieldSize(detail);
      const f = new Float32Array(cols * rows);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const stripe = Math.floor((x / cols) * 20) % 2 === 1 && x % 7 < 4;
          f[y * cols + x] = stripe ? 0.2 : 0.7 + 0.25 * (x / cols);
        }
      }
      return planSketch(f, SKETCH_WIDTH, SKETCH_HEIGHT, detail).coast.length;
    };
    const few = stripes(0.1);
    const more = stripes(0.5);
    expect(few).toBe(Math.round(3 + 14 * 0.1));
    expect(more).toBe(Math.round(3 + 14 * 0.5));
  });

  it("does not hatch a latitude band across a remote body, only what stands out from it", () => {
    const p = plan(0.28, [{ x: 0, y: 0.5, r: 0.12 }], [0.4, 0.6]);
    const midBandAcross = p.hatch.filter(([a, b]) => {
      const my = (a[1] + b[1]) / 2;
      const mx = (a[0] + b[0]) / 2;
      return (
        my > SKETCH_HEIGHT * 0.35 &&
        my < SKETCH_HEIGHT * 0.65 &&
        mx > SKETCH_WIDTH * 0.6
      );
    });
    expect(midBandAcross).toHaveLength(0);
  });

  it("shades a remote body toward its poles", () => {
    const p = plan(0.28, [{ x: 0.5, y: 0.5, r: 0.1 }]);
    const nearPole = p.hatch.filter(
      ([a]) => a[1] < SKETCH_HEIGHT * 0.15 || a[1] > SKETCH_HEIGHT * 0.85,
    );
    expect(nearPole.length).toBeGreaterThan(0);
  });
});

describe("sketch time", () => {
  /*
   * The browser measure at 1024x512 is a few ms for the whole sketch; this holds
   * the planning share, which is everything but the canvas, to a ceiling loose
   * enough for a machine running a full suite and tight enough to catch a plan
   * that has gone quadratic.
   */
  it.each([
    1, 0.9, 0.28, 0.13,
  ])("plans a detail %s sketch well inside the budget", (detail) => {
    const blobs = Array.from({ length: 12 }, (_, i) => ({
      x: 0.08 + (i % 6) * 0.16,
      y: i < 6 ? 0.3 : 0.7,
      r: 0.07,
    }));
    const { cols, rows } = fieldSize(detail);
    const field = terrain(cols, rows, blobs);
    planSketch(field, SKETCH_WIDTH, SKETCH_HEIGHT, detail);
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      planSketch(field, SKETCH_WIDTH, SKETCH_HEIGHT, detail);
      runs.push(performance.now() - t);
    }
    runs.sort((a, b) => a - b);
    expect(runs[2]).toBeLessThan(60);
  });
});
