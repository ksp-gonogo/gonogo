import { describe, expect, it } from "vitest";
import {
  liquidShade,
  luminanceOf,
  MAX_COMPONENTS,
  seaWaves,
  shadePlan,
} from "./seaField";

const KERBIN_G = 9.81;
const COLOUR = { r: 90, g: 143, b: 216 };

/** The windows a descent's touchdown plot passes through, metres across, each drawn 96 pixels wide. */
const WINDOWS = [14_000, 6_000, 2_000, 700, 240, 140];

describe("the sea's waves", () => {
  it("run at the speed deep water gives them on the body's gravity: omega squared is g k", () => {
    for (const w of seaWaves(240 / 96, 240, KERBIN_G)) {
      expect(w.omega ** 2).toBeCloseTo(KERBIN_G * w.k, 9);
    }
    const mun = seaWaves(240 / 96, 240, 1.63);
    const kerbin = seaWaves(240 / 96, 240, KERBIN_G);
    // The same wave runs slower under weaker gravity.
    expect(mun[0].omega).toBeLessThan(kerbin[0].omega);
  });

  it("are never more than the cap, at any zoom", () => {
    for (const span of WINDOWS) {
      expect(seaWaves(span / 96, span, KERBIN_G).length).toBeLessThanOrEqual(
        MAX_COMPONENTS,
      );
    }
  });

  it("fade in and out smoothly as the window closes, so nothing pops", () => {
    // A slow zoom from 2 km to 140 m in one-percent steps: no wave's weight may jump between two steps.
    const weightsAt = (span: number) =>
      new Map(seaWaves(span / 96, span, KERBIN_G).map((w) => [w.k, w.weight]));
    let previous = weightsAt(2_000);
    for (let span = 2_000 * 0.99; span > 140; span *= 0.99) {
      const now = weightsAt(span);
      for (const k of new Set([...previous.keys(), ...now.keys()])) {
        expect(
          Math.abs((now.get(k) ?? 0) - (previous.get(k) ?? 0)),
          `k=${k} at ${span.toFixed(0)} m`,
        ).toBeLessThan(0.12);
      }
      previous = now;
    }
  });

  it("bring finer waves in as the window closes, so no pattern holds one size on screen", () => {
    // The finest wave drawn, as a share of the window: about the same at every zoom, so the texture shrinks with the ground as terrain does.
    const finestShare = (span: number) => {
      const waves = seaWaves(span / 96, span, KERBIN_G).filter(
        (w) => w.weight > 0.5,
      );
      return Math.min(...waves.map((w) => (2 * Math.PI) / w.k)) / span;
    };
    const shares = [700, 240, 140].map(finestShare);
    for (const share of shares) {
      expect(share).toBeGreaterThan(0.02);
      expect(share).toBeLessThan(0.15);
    }
    const near = seaWaves(140 / 96, 140, KERBIN_G).map((w) => w.k);
    const far = seaWaves(2_000 / 96, 2_000, KERBIN_G).map((w) => w.k);
    expect(Math.max(...near)).toBeGreaterThan(Math.max(...far));
  });

  it("are nothing for a window or a gravity that is not known", () => {
    expect(seaWaves(Number.NaN, 240, KERBIN_G)).toEqual([]);
    expect(seaWaves(2, 240, 0)).toEqual([]);
  });
});

describe("the sea's shading", () => {
  const shade = (
    seconds: number,
    isSea?: (i: number, j: number) => boolean,
  ) => {
    const pixels = new Uint8ClampedArray(32 * 32 * 4);
    shadePlan(pixels, 32, 32, {
      east0: 123_456,
      north0: -7_890,
      dx: 240 / 32,
      dy: 240 / 32,
      seconds,
      colour: COLOUR,
      waves: seaWaves(240 / 32, 240, KERBIN_G),
      isSea,
    });
    return pixels;
  };

  it("is the same frame every time at the same time, so a render with the clock pinned never differs", () => {
    expect(shade(1_000)).toEqual(shade(1_000));
  });

  it("moves with time", () => {
    expect(shade(1_000)).not.toEqual(shade(1_000.5));
  });

  it("stays in the water's own hue, light and dark about it, quietly", () => {
    const pixels = shade(1_000);
    let lo = 255;
    let hi = 0;
    for (let o = 0; o < pixels.length; o += 4) {
      // Blue stays the strongest channel everywhere, glints included: no hue shift toward green or white-out.
      expect(pixels[o + 2]).toBeGreaterThanOrEqual(pixels[o + 1]);
      expect(pixels[o + 1]).toBeGreaterThanOrEqual(pixels[o]);
      lo = Math.min(lo, pixels[o + 2]);
      hi = Math.max(hi, pixels[o + 2]);
    }
    expect(hi).toBeGreaterThan(lo);
    // Low contrast: the brightest and darkest water within a third of the range.
    expect(hi - lo).toBeLessThan(85);
  });

  it("leaves land transparent on a coast", () => {
    const pixels = shade(1_000, (i) => i < 16);
    expect(pixels[(0 * 32 + 20) * 4 + 3]).toBe(0);
    expect(pixels[(0 * 32 + 4) * 4 + 3]).toBeGreaterThan(0);
  });
});

describe("a body's own liquid colour", () => {
  const hex = (h: string) => {
    const n = Number.parseInt(h.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  /** The theme's water token, and a light theme's darker one standing in for a theme that would register it. */
  const DARK_WATER = hex("#77ccff");
  const LIGHT_WATER = hex("#1f5f99");
  const STOCK = { Kerbin: "#243B47", Eve: "#AD94BE", Laythe: "#1E2028" };

  it("keeps Eve's purple: red and blue above green, blue the strongest", () => {
    const eve = liquidShade(hex(STOCK.Eve), DARK_WATER);
    expect(eve.b).toBeGreaterThan(eve.g);
    expect(eve.r).toBeGreaterThan(eve.g);
    expect(eve.b).toBeGreaterThanOrEqual(eve.r);
  });

  it("sits at the theme's own water brightness, so it is as quiet under the marks on a dark theme and a light one", () => {
    for (const water of [DARK_WATER, LIGHT_WATER]) {
      for (const liquid of Object.values(STOCK)) {
        const shade = liquidShade(hex(liquid), water);
        expect(luminanceOf(shade)).toBeCloseTo(luminanceOf(water), 2);
      }
    }
  });

  it("holds the water's contrast with the panel on either theme", () => {
    const ratio = (a: number, b: number) =>
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    for (const [water, panel] of [
      [DARK_WATER, 0.004],
      [LIGHT_WATER, 1],
    ] as const) {
      const theirs = ratio(luminanceOf(water), panel);
      for (const liquid of Object.values(STOCK)) {
        const ours = ratio(luminanceOf(liquidShade(hex(liquid), water)), panel);
        expect(ours / theirs).toBeGreaterThan(0.97);
        expect(ours / theirs).toBeLessThan(1.03);
      }
    }
  });
});
