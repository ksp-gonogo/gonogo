import { describe, expect, it } from "vitest";
import {
  projectDescent,
  relativeDensityCurve,
  terminalVelocityCurve,
} from "./descent";

/**
 * The descent maths, tested directly rather than read back out of an SVG path,
 * because the shape of the curve is the claim and a path attribute is only its
 * shadow.
 *
 * It lives here rather than beside the widget that first drew it because a
 * contributor to a velocity-height plot needs the same integrator: two
 * independently written ones put two answers on one plot and blame the physics
 * for the disagreement.
 */

/** Kerbin's surface gravity, the only body constant any of this needs. */
const KERBIN_G = 9.81;

/** A terminal-velocity model that does not vary with height, which isolates the
 *  relaxation from the shape of the curve it relaxes onto. */
const flat = (vt: number) => () => vt;

describe("projectDescent", () => {
  it("slows a vessel that is faster than terminal, toward terminal", () => {
    const p = projectDescent({
      startSpeed: 900,
      startAltitude: 20_000,
      surfaceGravity: KERBIN_G,
      terminalVelocityAt: flat(120),
    });
    expect(p.points[0].speed).toBeCloseTo(900, 5);
    expect(p.touchdownSpeed).toBeCloseTo(120, 0);
    // Monotonic: a descent above terminal never speeds up on the way down.
    for (let i = 1; i < p.points.length; i++) {
      expect(p.points[i].speed).toBeLessThanOrEqual(p.points[i - 1].speed);
    }
  });

  it("speeds up a vessel that is slower than terminal, toward terminal", () => {
    const p = projectDescent({
      startSpeed: 20,
      startAltitude: 20_000,
      surfaceGravity: KERBIN_G,
      terminalVelocityAt: flat(120),
    });
    expect(p.touchdownSpeed).toBeGreaterThan(20);
    expect(p.touchdownSpeed).toBeCloseTo(120, 0);
  });

  it("stays finite and positive from an enormous excess over terminal", () => {
    // The reason the step is the equation's exact solution rather than a
    // forward difference: an entry starts tens of times terminal velocity, and
    // a forward step there overshoots through zero into a negative speed.
    const p = projectDescent({
      startSpeed: 7800,
      startAltitude: 60_000,
      surfaceGravity: KERBIN_G,
      terminalVelocityAt: flat(90),
    });
    for (const point of p.points) {
      expect(Number.isFinite(point.speed)).toBe(true);
      expect(point.speed).toBeGreaterThan(0);
    }
    expect(p.touchdownSpeed).toBeCloseTo(90, 0);
  });

  it("reports the height it settles onto the curve at", () => {
    const p = projectDescent({
      startSpeed: 900,
      startAltitude: 20_000,
      surfaceGravity: KERBIN_G,
      terminalVelocityAt: flat(120),
    });
    expect(p.settleAltitude).not.toBeNull();
    expect(p.settleAltitude as number).toBeGreaterThan(0);
    expect(p.settleAltitude as number).toBeLessThan(20_000);
  });

  it("reports NO settle height for a vessel already riding the curve", () => {
    // It did not settle on the way down, it started settled, and a tick at the
    // vessel's own altitude would point at the mark beside it.
    const p = projectDescent({
      startSpeed: 121,
      startAltitude: 20_000,
      surfaceGravity: KERBIN_G,
      terminalVelocityAt: flat(120),
    });
    expect(p.settleAltitude).toBeNull();
  });

  it("settles DEEPER the higher the terminal velocity is", () => {
    // The plot's whole entry read: a high ballistic coefficient means a high
    // terminal velocity, which drives the deceleration further down.
    const shallow = projectDescent({
      startSpeed: 1400,
      startAltitude: 20_000,
      surfaceGravity: KERBIN_G,
      terminalVelocityAt: flat(90),
    });
    const deep = projectDescent({
      startSpeed: 1400,
      startAltitude: 20_000,
      surfaceGravity: KERBIN_G,
      terminalVelocityAt: flat(200),
    });
    expect(deep.settleAltitude as number).toBeLessThan(
      shallow.settleAltitude as number,
    );
  });
});

describe("terminalVelocityCurve", () => {
  const anchors = { speedNow: 300, altitudeNow: 28_000, groundSpeed: 95 };

  it("hits both anchors exactly, which is what lets two curves share a column", () => {
    const vt = terminalVelocityCurve(anchors);
    expect(vt(0)).toBeCloseTo(95, 6);
    expect(vt(28_000)).toBeCloseTo(300, 6);
  });

  it("grows with altitude, because thin air cannot hold a vessel back", () => {
    const vt = terminalVelocityCurve(anchors);
    expect(vt(14_000)).toBeGreaterThan(vt(0));
    expect(vt(28_000)).toBeGreaterThan(vt(14_000));
  });

  it("collapses to the ground anchor rather than dividing by nothing", () => {
    const vt = terminalVelocityCurve({ ...anchors, altitudeNow: 0 });
    expect(vt(1234)).toBe(95);
  });
});

describe("relativeDensityCurve", () => {
  it("is 1 at the ground and decays with altitude", () => {
    const rho = relativeDensityCurve({
      speedNow: 300,
      altitudeNow: 28_000,
      groundSpeed: 95,
    });
    expect(rho(0)).toBeCloseTo(1, 6);
    expect(rho(14_000)).toBeLessThan(1);
    expect(rho(28_000)).toBeLessThan(rho(14_000));
    expect(rho(28_000)).toBeGreaterThan(0);
  });

  it("agrees with the curve it is derived from, never a second model", () => {
    // v_t goes as 1/sqrt(rho), so the two are one statement written twice: a
    // haze drawn from this and a curve drawn from that cannot disagree.
    const anchors = { speedNow: 300, altitudeNow: 28_000, groundSpeed: 95 };
    const rho = relativeDensityCurve(anchors);
    const vt = terminalVelocityCurve(anchors);
    for (const alt of [0, 5_000, 14_000, 28_000]) {
      expect(rho(alt)).toBeCloseTo((95 / vt(alt)) ** 2, 6);
    }
  });
});
