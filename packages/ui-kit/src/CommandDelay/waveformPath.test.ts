import { describe, expect, it } from "vitest";
import { WAVE_HALF_H, WAVE_MID_Y, waveformPath } from "./waveformPath";

/** Every "x.xx,y.yy" vertex of a path, in order. */
function vertices(d: string): { x: number; y: number }[] {
  return [...d.matchAll(/(-?\d+\.\d\d),(-?\d+\.\d\d)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
}

const MID_Y = WAVE_MID_Y;

describe("waveformPath", () => {
  it("puts the newest sample at this end and older ones further out", () => {
    // Newest last in, so 0.9 is `now` and lands at x=0.
    const d = waveformPath([0.1, 0.9], 1, 100);
    expect(d.startsWith("M0.00,")).toBe(true);
    expect(d).toContain("100.00,");
  });

  it("crosses the centre line, so an amplitude is a PEAK and not a pen width", () => {
    // A wave goes above the line and then below it, never a thickening stroke.
    const ys = vertices(waveformPath(new Array(64).fill(1), 63, 100)).map(
      (v) => v.y,
    );
    expect(ys.some((y) => y < MID_Y)).toBe(true);
    expect(ys.some((y) => y > MID_Y)).toBe(true);
    for (let i = 1; i < ys.length; i++) {
      expect(Math.sign(ys[i] - MID_Y)).toBe(-Math.sign(ys[i - 1] - MID_Y));
    }
  });

  it("is an open trace, not the closed outline of a filled shape", () => {
    expect(waveformPath([0.5, 0.5, 0.5], 2, 100).endsWith(" Z")).toBe(false);
  });

  it("holds one period whatever the sample density, so it always reads as a wave", () => {
    // The period is the drawing's, not the capture rate's, so a dense ring never becomes a solid hatch.
    const dense = waveformPath(new Array(129).fill(0.5), 128, 100);
    const sparse = waveformPath(new Array(51).fill(0.5), 50, 100);
    expect(vertices(dense)).toHaveLength(vertices(sparse).length);
    expect(vertices(dense).length).toBeGreaterThan(8);
  });

  it("is symmetric about the mid-line, so the peaks read either way", () => {
    const d = waveformPath(new Array(64).fill(1), 63, 100);
    expect(d).toContain(`,${(MID_Y - WAVE_HALF_H).toFixed(2)}`);
    expect(d).toContain(`,${(MID_Y + WAVE_HALF_H).toFixed(2)}`);
  });

  it("drops samples that have already arrived rather than piling them up", () => {
    // Ages 0-2 are still crossing and the older three are home, so the trace stops at the boundary.
    const wide = vertices(waveformPath([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 2, 100));
    expect(wide[wide.length - 1].x).toBe(100);
  });

  it("draws silence as a flat line on the centre rather than as nothing at all", () => {
    const flat = vertices(waveformPath(new Array(32).fill(0), 31, 100));
    expect(flat.length).toBeGreaterThan(1);
    for (const v of flat) expect(v.y).toBe(MID_Y);
  });

  it("is empty with nothing to draw", () => {
    expect(waveformPath([], 4, 100)).toBe("");
  });

  it("survives a non-finite sample rather than emitting NaN geometry", () => {
    const d = waveformPath([Number.NaN, 0.5], 1, 100);
    expect(d).not.toContain("NaN");
  });
});

// `x` is AGE, so the trace's reach is a MEASUREMENT; widening it would put recent audio where older audio is.
describe("the trace reaches as far as the history it holds", () => {
  const lastX = (d: string): number => {
    const v = vertices(d);
    return v.length === 0 ? 0 : v[v.length - 1].x;
  };

  it("puts each sample where that audio actually is in the gap", () => {
    // 600 samples back in a 3000-sample gap belongs a fifth of the way across.
    const ring = new Array(1201).fill(0);
    ring[ring.length - 1 - 600] = 1;
    const peak = vertices(waveformPath(ring, 3000, 100)).find(
      (v) => Math.abs(v.y - MID_Y) > 5,
    );
    expect(peak?.x).toBe(20);
  });

  it("stops where the held history stops rather than spreading it to fill the gap", () => {
    // The rest of the rail is audio in flight the caller discarded, so the trace ends at 40%.
    expect(lastX(waveformPath(new Array(1201).fill(0.5), 3000, 100))).toBe(40);
  });

  it("reaches the boundary once the ring covers the gap", () => {
    // What `amplitudeHistoryFor` sizes for: one sample past the light-time.
    expect(lastX(waveformPath(new Array(3001).fill(0.5), 3000, 100))).toBe(100);
  });

  it("grows the reach with the ring, at one sample per sample of gap", () => {
    const reach = (held: number): number =>
      lastX(waveformPath(new Array(held).fill(0.5), 3000, 100));
    expect(reach(301)).toBe(10);
    expect(reach(1501)).toBe(50);
    expect(reach(3001)).toBe(100);
  });
});

describe("the trace never draws more detail than it has", () => {
  const turningPoints = (d: string): number => vertices(d).length;
  const lastX = (d: string): number => {
    const v = vertices(d);
    return v.length === 0 ? 0 : v[v.length - 1].x;
  };

  it("does not fabricate a full-width wave from a sub-chunk light-time", () => {
    // At low orbit the gap holds a fraction of one sample: full reach, but no invented turning points.
    const d = waveformPath(new Array(128).fill(0.8), 0.035, 100);
    expect(lastX(d)).toBe(100);
    expect(turningPoints(d)).toBeLessThanOrEqual(3);
    // Still a wave and not a ramp: it has to cross the centre to read as one.
    const ys = vertices(d).map((v) => v.y);
    expect(ys.some((y) => y < MID_Y)).toBe(true);
    expect(ys.some((y) => y > MID_Y)).toBe(true);
  });

  it("draws one turning point per in-flight sample when the gap is short", () => {
    // 0.2 s of light-time is ten chunks: ten samples of evidence, ten peaks.
    const d = waveformPath(new Array(128).fill(0.8), 10, 100);
    expect(turningPoints(d)).toBeLessThanOrEqual(11);
    expect(turningPoints(d)).toBeGreaterThan(4);
  });

  it("leaves the fixed drawing pitch alone once there is evidence for it", () => {
    // At every separation the ring covers, the pitch is the tighter limit.
    const near = waveformPath(new Array(129).fill(0.8), 128, 100);
    const far = waveformPath(new Array(3001).fill(0.8), 3000, 100);
    expect(turningPoints(near)).toBe(turningPoints(far));
    expect(turningPoints(near)).toBeGreaterThan(40);
  });

  it("still tells silence from voice at a sub-chunk light-time", () => {
    // Both halves: at three turning points the HEIGHT separates them, not the spread.
    const quiet = waveformPath(new Array(128).fill(0), 0.035, 100);
    for (const v of vertices(quiet)) expect(v.y).toBe(MID_Y);
    const loud = waveformPath(new Array(128).fill(0.8), 0.035, 100);
    for (const v of vertices(loud)) expect(v.y).not.toBe(MID_Y);
  });

  it("draws the sub-chunk gap at the level being spoken NOW", () => {
    // A gap holding a fraction of one sample draws the newest sample; the older ones have arrived.
    const ring = new Array(128).fill(0.2);
    ring[ring.length - 1] = 0.9;
    const heights = vertices(waveformPath(ring, 0.035, 100)).map((v) =>
      Math.abs(v.y - MID_Y),
    );
    for (const h of heights) expect(h).toBeCloseTo(0.9 * WAVE_HALF_H, 5);
  });
});
