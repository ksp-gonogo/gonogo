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
    /*
     * The defect this replaces: a filled envelope, thin where the operator was
     * quiet and fat where they were loud, which reads as a growing stroke
     * rather than as a wave. A wave goes above the line and then below it.
     */
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
    /*
     * 128 chunks of history and 50 draw the same number of vertices over the
     * same distance: the period is the DRAWING's, not the capture rate's, so a
     * dense ring does not collapse into a solid hatch.
     */
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
    // span 2 => ages 0,1,2 are still crossing; the three older ones are home,
    // so the trace reaches the boundary and stops rather than folding them in.
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

/**
 * `x` is AGE, and the trace's reach is therefore a MEASUREMENT of how much of
 * the gap the caller can still account for. These are the ratchets against
 * widening the drawing to cover for a short ring, which would put recent audio
 * where older audio actually is.
 */
describe("the trace reaches as far as the history it holds", () => {
  const lastX = (d: string): number => {
    const v = vertices(d);
    return v.length === 0 ? 0 : v[v.length - 1].x;
  };

  it("puts each sample where that audio actually is in the gap", () => {
    /*
     * One loud chunk 600 samples back, in a gap 3000 samples wide, belongs a
     * fifth of the way across, because that is where that sound is. Anywhere
     * else is a false claim about position on a widget whose whole job is
     * position.
     */
    const ring = new Array(1201).fill(0);
    ring[ring.length - 1 - 600] = 1;
    const peak = vertices(waveformPath(ring, 3000, 100)).find(
      (v) => Math.abs(v.y - MID_Y) > 5,
    );
    expect(peak?.x).toBe(20);
  });

  it("stops where the held history stops rather than spreading it to fill the gap", () => {
    /*
     * 1200 samples back in a 3000-sample gap is 40% of the rail. The other 60%
     * is audio equally in flight that the caller has discarded, and a trace
     * ending here is what says so. Widening it to the boundary was proposed and
     * rejected: the fix for a short trace is a longer ring at the caller.
     */
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
    /*
     * The second defect, and the same lie in the other direction: at low orbit
     * the light-time is well under one 20 ms chunk, so the gap holds a fraction
     * of a single sample. Floored to a span of 1 the rail drew a confident
     * 50-point sawtooth off two samples, full width, perfectly legible,
     * identical for every transmission at low orbit, and saying nothing. The
     * gap IS full, so the reach is right; the ink implying fifty turning points
     * of captured shape was not.
     */
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
    /*
     * The pitch is the tighter of the two limits at every separation the ring
     * can cover, so the cap changes nothing about how a normal trace reads.
     */
    const near = waveformPath(new Array(129).fill(0.8), 128, 100);
    const far = waveformPath(new Array(3001).fill(0.8), 3000, 100);
    expect(turningPoints(near)).toBe(turningPoints(far));
    expect(turningPoints(near)).toBeGreaterThan(40);
  });

  it("still tells silence from voice at a sub-chunk light-time", () => {
    /*
     * Both halves, because the reading that separates them at three turning
     * points is the HEIGHT and not the spread: a chevron of one amplitude and a
     * flat line have the same spread, so a spread-only check would call the
     * pair indistinguishable and be wrong.
     */
    const quiet = waveformPath(new Array(128).fill(0), 0.035, 100);
    for (const v of vertices(quiet)) expect(v.y).toBe(MID_Y);
    const loud = waveformPath(new Array(128).fill(0.8), 0.035, 100);
    for (const v of vertices(loud)) expect(v.y).not.toBe(MID_Y);
  });

  it("draws the sub-chunk gap at the level being spoken NOW", () => {
    /*
     * A gap holding a fraction of one sample holds the sample the operator is
     * speaking into it, so that is the one drawn. The ring's older samples have
     * long since arrived.
     */
    const ring = new Array(128).fill(0.2);
    ring[ring.length - 1] = 0.9;
    const heights = vertices(waveformPath(ring, 0.035, 100)).map((v) =>
      Math.abs(v.y - MID_Y),
    );
    for (const h of heights) expect(h).toBeCloseTo(0.9 * WAVE_HALF_H, 5);
  });
});
