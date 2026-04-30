import { describe, expect, it } from "vitest";
import {
  type CurrentOrbit,
  circularizeAtApo,
  circularizeAtPeri,
  customAtApsis,
  customAtUT,
  gravParameterFromState,
  hohmannRendezvous,
  hohmannToRadius,
  matchInclination,
  matchTargetPlane,
  stateAtUT,
} from "./maneuver";

// Kerbin's gravitational parameter (m³/s²).
const KERBIN_MU = 3.5316e12;
// Equatorial radius in metres.
const KERBIN_R = 600_000;

/**
 * 100 km circular orbit at Kerbin. Used as a neutral "no-op" baseline —
 * circularising a circle should give ~zero ΔV.
 */
const KERBIN_100KM_CIRCULAR: CurrentOrbit = {
  sma: KERBIN_R + 100_000,
  eccentricity: 0,
  ApR: KERBIN_R + 100_000,
  PeR: KERBIN_R + 100_000,
  timeToAp: 0,
  timeToPe: 0,
};

/**
 * Elliptic orbit with 80 km peri, 150 km apo. The circularise-at-apo
 * preset should burn prograde to raise the peri to the apo altitude.
 */
const KERBIN_ELLIPTIC: CurrentOrbit = {
  sma: KERBIN_R + (80_000 + 150_000) / 2,
  eccentricity: (150_000 - 80_000) / (2 * KERBIN_R + 80_000 + 150_000),
  ApR: KERBIN_R + 150_000,
  PeR: KERBIN_R + 80_000,
  timeToAp: 600,
  timeToPe: 1000,
};

describe("gravParameterFromState", () => {
  it("recovers μ from a circular orbit's v and r", () => {
    // For a circular orbit v = √(μ/r), so μ = v²·r.
    const r = 700_000;
    const v = Math.sqrt(KERBIN_MU / r);
    const mu = gravParameterFromState(v, r, r);
    expect(mu).toBeCloseTo(KERBIN_MU, -3);
  });

  it("recovers μ from a point on an elliptic orbit", () => {
    const a = KERBIN_ELLIPTIC.sma;
    const r = KERBIN_ELLIPTIC.ApR;
    const v = Math.sqrt(KERBIN_MU * (2 / r - 1 / a));
    const mu = gravParameterFromState(v, r, a);
    expect(mu).toBeCloseTo(KERBIN_MU, -3);
  });
});

describe("circularizeAtApo", () => {
  it("needs ~zero ΔV for an already-circular orbit", () => {
    const plan = circularizeAtApo(KERBIN_100KM_CIRCULAR, KERBIN_MU, 0);
    expect(Math.abs(plan.prograde)).toBeLessThan(1e-6);
    expect(plan.requiredDeltaV).toBeLessThan(1e-6);
  });

  it("returns a positive prograde burn to circularise an elliptic orbit", () => {
    const plan = circularizeAtApo(KERBIN_ELLIPTIC, KERBIN_MU, 1000);
    expect(plan.prograde).toBeGreaterThan(0);
    expect(plan.ut).toBe(1000 + KERBIN_ELLIPTIC.timeToAp);
    expect(plan.normal).toBe(0);
    expect(plan.radial).toBe(0);
  });

  it("projects a circular post-burn orbit at the apoapsis radius", () => {
    const plan = circularizeAtApo(KERBIN_ELLIPTIC, KERBIN_MU, 0);
    expect(plan.projected).not.toBeNull();
    expect(plan.projected?.eccentricity).toBe(0);
    expect(plan.projected?.sma).toBe(KERBIN_ELLIPTIC.ApR);
    expect(plan.projected?.ApR).toBe(KERBIN_ELLIPTIC.ApR);
    expect(plan.projected?.PeR).toBe(KERBIN_ELLIPTIC.ApR);
  });
});

describe("circularizeAtPeri", () => {
  it("returns a negative prograde burn when peri is below apo", () => {
    // Circularising at the low point requires braking — the orbit is moving
    // too fast for a circle at that radius.
    const plan = circularizeAtPeri(KERBIN_ELLIPTIC, KERBIN_MU, 0);
    expect(plan.prograde).toBeLessThan(0);
    expect(plan.requiredDeltaV).toBe(Math.abs(plan.prograde));
  });

  it("projects a circle at periapsis radius", () => {
    const plan = circularizeAtPeri(KERBIN_ELLIPTIC, KERBIN_MU, 0);
    expect(plan.projected?.eccentricity).toBe(0);
    expect(plan.projected?.sma).toBe(KERBIN_ELLIPTIC.PeR);
  });
});

describe("customAtApsis", () => {
  it("produces an unchanged orbit for a zero-ΔV plan", () => {
    const plan = customAtApsis(KERBIN_ELLIPTIC, KERBIN_MU, 0, "apo", 0, 0, 0);
    expect(plan.requiredDeltaV).toBe(0);
    expect(plan.projected?.ApR).toBeCloseTo(KERBIN_ELLIPTIC.ApR, -2);
    expect(plan.projected?.PeR).toBeCloseTo(KERBIN_ELLIPTIC.PeR, -2);
    expect(plan.projected?.eccentricity).toBeCloseTo(
      KERBIN_ELLIPTIC.eccentricity,
      5,
    );
  });

  it("retrograde at apoapsis lowers periapsis", () => {
    const plan = customAtApsis(KERBIN_ELLIPTIC, KERBIN_MU, 0, "apo", -50, 0, 0);
    expect(plan.projected?.PeR).toBeLessThan(KERBIN_ELLIPTIC.PeR);
    // Apoapsis unchanged — the burn happens AT apoapsis, and prograde burns
    // at apoapsis change only the opposite apsis.
    expect(plan.projected?.ApR).toBeCloseTo(KERBIN_ELLIPTIC.ApR, -1);
  });

  it("prograde at periapsis raises apoapsis", () => {
    const plan = customAtApsis(
      KERBIN_ELLIPTIC,
      KERBIN_MU,
      0,
      "peri",
      100,
      0,
      0,
    );
    expect(plan.projected?.ApR).toBeGreaterThan(KERBIN_ELLIPTIC.ApR);
    expect(plan.projected?.PeR).toBeCloseTo(KERBIN_ELLIPTIC.PeR, -1);
  });

  it("carries normal component through but doesn't reshape in-plane orbit", () => {
    const plan = customAtApsis(KERBIN_ELLIPTIC, KERBIN_MU, 0, "apo", 0, 120, 0);
    expect(plan.normal).toBe(120);
    expect(plan.requiredDeltaV).toBeCloseTo(120, 5);
    expect(plan.projected?.ApR).toBeCloseTo(KERBIN_ELLIPTIC.ApR, -1);
    expect(plan.projected?.PeR).toBeCloseTo(KERBIN_ELLIPTIC.PeR, -1);
  });

  it("returns null projection when the burn escapes (hyperbolic)", () => {
    // Huge prograde kick at apo should push past escape velocity.
    const plan = customAtApsis(
      KERBIN_ELLIPTIC,
      KERBIN_MU,
      0,
      "apo",
      5000,
      0,
      0,
    );
    expect(plan.projected).toBeNull();
  });
});

describe("stateAtUT", () => {
  it("recovers the current state when dt = 0", () => {
    // True anomaly 0 = at periapsis on the elliptic orbit.
    const s = stateAtUT(KERBIN_ELLIPTIC, 0, KERBIN_MU, 0, 0);
    expect(s.r).toBeCloseTo(KERBIN_ELLIPTIC.PeR, -1);
    // At periapsis γ = 0.
    expect(s.flightPathAngle).toBeCloseTo(0, 6);
  });

  it("returns to the same state after one full period", () => {
    const a = KERBIN_ELLIPTIC.sma;
    const period = 2 * Math.PI * Math.sqrt((a * a * a) / KERBIN_MU);
    const at0 = stateAtUT(KERBIN_ELLIPTIC, 30, KERBIN_MU, 0, 0);
    const at1 = stateAtUT(KERBIN_ELLIPTIC, 30, KERBIN_MU, 0, period);
    expect(at1.r).toBeCloseTo(at0.r, -1);
    expect(at1.speed).toBeCloseTo(at0.speed, -1);
    expect(at1.flightPathAngle).toBeCloseTo(at0.flightPathAngle, 4);
  });

  it("returns constant r / speed and γ=0 on a circular orbit", () => {
    const s0 = stateAtUT(KERBIN_100KM_CIRCULAR, 0, KERBIN_MU, 0, 0);
    const s1 = stateAtUT(KERBIN_100KM_CIRCULAR, 0, KERBIN_MU, 0, 500);
    expect(s1.r).toBeCloseTo(s0.r, -1);
    expect(s1.speed).toBeCloseTo(s0.speed, -1);
    expect(s1.flightPathAngle).toBeCloseTo(0, 6);
  });

  it("reaches apoapsis r when propagated by timeToAp from periapsis", () => {
    // True anomaly 0° = periapsis. Half a period later we're at apoapsis.
    const a = KERBIN_ELLIPTIC.sma;
    const halfPeriod = Math.PI * Math.sqrt((a * a * a) / KERBIN_MU);
    const s = stateAtUT(KERBIN_ELLIPTIC, 0, KERBIN_MU, 0, halfPeriod);
    expect(s.r).toBeCloseTo(KERBIN_ELLIPTIC.ApR, -1);
    expect(s.flightPathAngle).toBeCloseTo(0, 4);
  });
});

describe("customAtUT", () => {
  it("is a no-op for zero ΔV at any future UT", () => {
    const plan = customAtUT(KERBIN_ELLIPTIC, 30, KERBIN_MU, 0, 800, 0, 0, 0);
    expect(plan.projected).not.toBeNull();
    expect(plan.projected?.sma).toBeCloseTo(KERBIN_ELLIPTIC.sma, -2);
    expect(plan.projected?.eccentricity).toBeCloseTo(
      KERBIN_ELLIPTIC.eccentricity,
      4,
    );
  });

  it("matches customAtApsis when burnUT lands on the next apoapsis", () => {
    const currentUT = 1000;
    // Start at periapsis (trueAnomaly = 0). Apoapsis is half a period later.
    const a = KERBIN_ELLIPTIC.sma;
    const halfPeriod = Math.PI * Math.sqrt((a * a * a) / KERBIN_MU);
    const orbit: CurrentOrbit = { ...KERBIN_ELLIPTIC, timeToAp: halfPeriod };
    const apoPlan = customAtApsis(
      orbit,
      KERBIN_MU,
      currentUT,
      "apo",
      -100,
      0,
      0,
    );
    const utPlan = customAtUT(
      orbit,
      0,
      KERBIN_MU,
      currentUT,
      currentUT + halfPeriod,
      -100,
      0,
      0,
    );
    expect(utPlan.ut).toBe(apoPlan.ut);
    expect(utPlan.projected?.ApR).toBeCloseTo(apoPlan.projected?.ApR ?? 0, -1);
    expect(utPlan.projected?.PeR).toBeCloseTo(apoPlan.projected?.PeR ?? 0, -1);
    expect(utPlan.projected?.eccentricity).toBeCloseTo(
      apoPlan.projected?.eccentricity ?? 0,
      4,
    );
  });

  it("yields a non-zero flight-path-angle projection mid-orbit", () => {
    // Partway between peri and apo: γ is non-zero, so the in-plane math
    // exercises the full projectBurn (not just the apsis shortcut).
    const a = KERBIN_ELLIPTIC.sma;
    const quarterPeriod = (Math.PI / 2) * Math.sqrt((a * a * a) / KERBIN_MU);
    const plan = customAtUT(
      KERBIN_ELLIPTIC,
      0,
      KERBIN_MU,
      0,
      quarterPeriod,
      50,
      0,
      0,
    );
    expect(plan.projected).not.toBeNull();
    // Prograde boost away from an apsis raises sma.
    expect(plan.projected?.sma).toBeGreaterThan(KERBIN_ELLIPTIC.sma);
  });

  it("refuses to plan burns in the past", () => {
    const plan = customAtUT(
      KERBIN_ELLIPTIC,
      0,
      KERBIN_MU,
      1000,
      500,
      100,
      0,
      0,
    );
    expect(plan.projected).toBeNull();
    expect(plan.ut).toBe(500);
    expect(plan.requiredDeltaV).toBe(100);
  });
});

describe("matchInclination", () => {
  it("requires ~zero ΔV when the target equals the current inclination", () => {
    const plan = matchInclination(
      KERBIN_100KM_CIRCULAR,
      0, // ν
      0, // argPe (AN at ν = 0)
      45, // current inc
      KERBIN_MU,
      0,
      45, // same target
    );
    expect(Math.abs(plan.normal)).toBeLessThan(1e-6);
    expect(plan.prograde).toBe(0);
    expect(plan.radial).toBe(0);
    expect(plan.projected?.inclination).toBe(45);
  });

  it("matches the textbook pure-inclination formula on a circular orbit", () => {
    // 100 km Kerbin circular: v ≈ sqrt(μ/r)
    const r = KERBIN_100KM_CIRCULAR.sma;
    const v = Math.sqrt(KERBIN_MU / r);
    const deltaIRad = (30 * Math.PI) / 180;
    const expected = 2 * v * Math.sin(deltaIRad / 2);

    const plan = matchInclination(
      KERBIN_100KM_CIRCULAR,
      0,
      0,
      0, // current inc
      KERBIN_MU,
      0,
      30, // target +30°
    );
    expect(Math.abs(plan.normal)).toBeCloseTo(expected, 0);
    expect(plan.projected?.inclination).toBe(30);
  });

  it("reverses the normal sign when the target inclination is lower", () => {
    const planUp = matchInclination(
      KERBIN_100KM_CIRCULAR,
      0,
      0,
      0,
      KERBIN_MU,
      0,
      30,
    );
    const planDown = matchInclination(
      KERBIN_100KM_CIRCULAR,
      0,
      0,
      30,
      KERBIN_MU,
      0,
      0,
    );
    // Same geometry → same magnitude, opposite sign.
    expect(Math.abs(planUp.normal + planDown.normal)).toBeLessThan(1e-6);
  });

  it("schedules the burn at the nearer of AN / DN", () => {
    // argPe = 0 → AN at ν = 0, DN at ν = 180. Current ν just past AN →
    // DN is nearer.
    const plan = matchInclination(
      KERBIN_100KM_CIRCULAR,
      10, // current ν just past AN
      0, // argPe
      0,
      KERBIN_MU,
      1000,
      10,
    );
    // ν needs to reach 180° (DN). On a circular orbit with period T,
    // that takes roughly (170°/360°)·T seconds.
    const period =
      2 * Math.PI * Math.sqrt(KERBIN_100KM_CIRCULAR.sma ** 3 / KERBIN_MU);
    const expectedDt = (170 / 360) * period;
    expect(plan.ut - 1000).toBeCloseTo(expectedDt, -1);
  });
});

describe("matchTargetPlane", () => {
  it("requires ~zero ΔV when the target plane equals the current plane", () => {
    const plan = matchTargetPlane(
      KERBIN_100KM_CIRCULAR,
      45, // ν
      20, // argPe
      30, // inc
      50, // LAN
      30, // target inc (same)
      50, // target LAN (same)
      KERBIN_MU,
      0,
    );
    expect(Math.abs(plan.normal)).toBeLessThan(1e-6);
    expect(plan.requiredDeltaV).toBeLessThan(1e-6);
  });

  it("reduces to pure inclination change when LAN matches", () => {
    // Same LAN → the relative-plane intersection is our own AN/DN line,
    // so matchTargetPlane should produce the same ΔV as matchInclination.
    const targetInc = 30;
    const tp = matchTargetPlane(
      KERBIN_100KM_CIRCULAR,
      10,
      0,
      0,
      0,
      targetInc,
      0,
      KERBIN_MU,
      0,
    );
    const mi = matchInclination(
      KERBIN_100KM_CIRCULAR,
      10,
      0,
      0,
      KERBIN_MU,
      0,
      targetInc,
    );
    expect(Math.abs(tp.normal)).toBeCloseTo(Math.abs(mi.normal), 0);
  });

  it("produces a non-zero ΔV when only LAN differs", () => {
    const plan = matchTargetPlane(
      KERBIN_100KM_CIRCULAR,
      0,
      0,
      10, // non-zero inc so the LAN distinction matters geometrically
      0,
      10,
      45, // LAN shifted 45° → relative plane differs
      KERBIN_MU,
      0,
    );
    expect(plan.requiredDeltaV).toBeGreaterThan(0);
    expect(plan.projected?.inclination).toBe(10);
  });
});

describe("hohmannToRadius", () => {
  // 200 km circular target from a 100 km circular start.
  const KERBIN_200KM = KERBIN_R + 200_000;

  it("returns null for a non-positive targetR", () => {
    expect(hohmannToRadius(KERBIN_100KM_CIRCULAR, KERBIN_MU, 0, 0)).toBeNull();
    expect(
      hohmannToRadius(KERBIN_100KM_CIRCULAR, KERBIN_MU, 0, -10),
    ).toBeNull();
  });

  it("returns null when μ is non-positive", () => {
    expect(
      hohmannToRadius(KERBIN_100KM_CIRCULAR, 0, 0, KERBIN_200KM),
    ).toBeNull();
  });

  it("matches the textbook ΔV for circular→circular raise (Kerbin 100→200 km)", () => {
    const seq = hohmannToRadius(
      KERBIN_100KM_CIRCULAR,
      KERBIN_MU,
      0,
      KERBIN_200KM,
    );
    expect(seq).not.toBeNull();
    if (!seq) return;

    // Closed-form vis-viva: dv1 = v_t(r1) − v_circ(r1); dv2 = v_circ(r2) − v_t(r2).
    const r1 = KERBIN_R + 100_000;
    const r2 = KERBIN_200KM;
    const at = (r1 + r2) / 2;
    const vCircR1 = Math.sqrt(KERBIN_MU / r1);
    const vCircR2 = Math.sqrt(KERBIN_MU / r2);
    const vTransR1 = Math.sqrt(KERBIN_MU * (2 / r1 - 1 / at));
    const vTransR2 = Math.sqrt(KERBIN_MU * (2 / r2 - 1 / at));
    const expectedDv1 = vTransR1 - vCircR1;
    const expectedDv2 = vCircR2 - vTransR2;

    expect(seq.burns[0].prograde).toBeCloseTo(expectedDv1, 3);
    expect(seq.burns[1].prograde).toBeCloseTo(expectedDv2, 3);
    expect(seq.totalDeltaV).toBeCloseTo(
      Math.abs(expectedDv1) + Math.abs(expectedDv2),
      3,
    );
  });

  it("burns are pure prograde — no normal or radial components", () => {
    const seq = hohmannToRadius(
      KERBIN_100KM_CIRCULAR,
      KERBIN_MU,
      0,
      KERBIN_200KM,
    );
    if (!seq) throw new Error("expected sequence");
    for (const b of seq.burns) {
      expect(b.normal).toBe(0);
      expect(b.radial).toBe(0);
    }
  });

  it("schedules burn 2 half a transfer period after burn 1", () => {
    const seq = hohmannToRadius(
      KERBIN_100KM_CIRCULAR,
      KERBIN_MU,
      0,
      KERBIN_200KM,
    );
    if (!seq) throw new Error("expected sequence");
    const at = (KERBIN_R + 100_000 + KERBIN_200KM) / 2;
    const halfPeriod = Math.PI * Math.sqrt((at * at * at) / KERBIN_MU);
    expect(seq.burns[1].ut - seq.burns[0].ut).toBeCloseTo(halfPeriod, 3);
  });

  it("final orbit is circular at targetR", () => {
    const seq = hohmannToRadius(
      KERBIN_100KM_CIRCULAR,
      KERBIN_MU,
      0,
      KERBIN_200KM,
    );
    if (!seq) throw new Error("expected sequence");
    expect(seq.finalProjected).not.toBeNull();
    expect(seq.finalProjected?.eccentricity).toBe(0);
    expect(seq.finalProjected?.ApR).toBe(KERBIN_200KM);
    expect(seq.finalProjected?.PeR).toBe(KERBIN_200KM);
  });

  it("transfer ellipse spans r1 and targetR", () => {
    const seq = hohmannToRadius(
      KERBIN_100KM_CIRCULAR,
      KERBIN_MU,
      0,
      KERBIN_200KM,
    );
    if (!seq) throw new Error("expected sequence");
    expect(seq.transferEllipse).not.toBeNull();
    expect(seq.transferEllipse?.PeR).toBe(KERBIN_R + 100_000);
    expect(seq.transferEllipse?.ApR).toBe(KERBIN_200KM);
  });

  it("both burns are negative when lowering to a smaller radius", () => {
    // 200 km → 100 km circular: brake at apo to lower opposite peri,
    // then brake at peri to circularise.
    const start: CurrentOrbit = {
      sma: KERBIN_200KM,
      eccentricity: 0,
      ApR: KERBIN_200KM,
      PeR: KERBIN_200KM,
      timeToAp: 0,
      timeToPe: 0,
    };
    const seq = hohmannToRadius(start, KERBIN_MU, 0, KERBIN_R + 100_000);
    if (!seq) throw new Error("expected sequence");
    expect(seq.burns[0].prograde).toBeLessThan(0);
    expect(seq.burns[1].prograde).toBeLessThan(0);
  });

  it("default heuristic picks peri when raising, apo when lowering", () => {
    // Raise from elliptic. Heuristic should burn at peri (timeToPe = 1000).
    const raise = hohmannToRadius(
      KERBIN_ELLIPTIC,
      KERBIN_MU,
      0,
      KERBIN_R + 300_000,
    );
    if (!raise) throw new Error("expected raise sequence");
    expect(raise.burns[0].ut).toBe(KERBIN_ELLIPTIC.timeToPe);

    // Lower from elliptic. Heuristic should burn at apo (timeToAp = 600).
    const lower = hohmannToRadius(
      KERBIN_ELLIPTIC,
      KERBIN_MU,
      0,
      KERBIN_R + 50_000,
    );
    if (!lower) throw new Error("expected lower sequence");
    expect(lower.burns[0].ut).toBe(KERBIN_ELLIPTIC.timeToAp);
  });

  it("respects explicit fromApsis override", () => {
    // Force apo-first even though we're raising — the burn UT should
    // match timeToAp, not timeToPe.
    const seq = hohmannToRadius(
      KERBIN_ELLIPTIC,
      KERBIN_MU,
      0,
      KERBIN_R + 300_000,
      "apo",
    );
    if (!seq) throw new Error("expected sequence");
    expect(seq.burns[0].ut).toBe(KERBIN_ELLIPTIC.timeToAp);
  });

  it("zero ΔV when target equals current circular radius", () => {
    const seq = hohmannToRadius(
      KERBIN_100KM_CIRCULAR,
      KERBIN_MU,
      0,
      KERBIN_R + 100_000,
    );
    if (!seq) throw new Error("expected sequence");
    expect(seq.totalDeltaV).toBeCloseTo(0, 6);
  });
});

describe("hohmannRendezvous", () => {
  // Coplanar circular vessel @100km, target circular @200km — clean Hohmann.
  const VESSEL_100KM_CIRCULAR_RICH = {
    ...KERBIN_100KM_CIRCULAR,
    trueAnomaly: 0,
    argPe: 0,
    inc: 0,
    lan: 0,
  };
  const TARGET_200KM_CIRCULAR = {
    sma: KERBIN_R + 200_000,
    PeR: KERBIN_R + 200_000,
    inclinationDeg: 0,
    lanDeg: 0,
    argPeDeg: 0,
    trueAnomalyDeg: 90, // 90° ahead of vessel
    period: 2 * Math.PI * Math.sqrt((KERBIN_R + 200_000) ** 3 / KERBIN_MU),
  };

  it("returns null on degenerate inputs", () => {
    const v = VESSEL_100KM_CIRCULAR_RICH;
    expect(
      hohmannRendezvous(v, 0, 0, 0, 0, 0, 0, TARGET_200KM_CIRCULAR, 0),
    ).toBeNull();
    expect(
      hohmannRendezvous(
        v,
        0,
        0,
        0,
        0,
        KERBIN_MU,
        0,
        {
          ...TARGET_200KM_CIRCULAR,
          PeR: 0,
        },
        0,
      ),
    ).toBeNull();
  });

  it("coplanar case produces 2 burns (no plane match)", () => {
    const v = VESSEL_100KM_CIRCULAR_RICH;
    const seq = hohmannRendezvous(
      v,
      v.trueAnomaly,
      v.argPe,
      v.inc,
      v.lan,
      KERBIN_MU,
      0,
      TARGET_200KM_CIRCULAR,
      0,
    );
    if (!seq) throw new Error("expected sequence");
    expect(seq.burns).toHaveLength(2);
    // Both prograde burns positive (raising)
    expect(seq.burns[0].prograde).toBeGreaterThan(0);
    expect(seq.burns[1].prograde).toBeGreaterThan(0);
    expect(seq.burns[0].normal).toBe(0);
    expect(seq.burns[1].normal).toBe(0);
  });

  it("inclined target prepends a plane-match burn", () => {
    const v = VESSEL_100KM_CIRCULAR_RICH;
    const seq = hohmannRendezvous(
      v,
      v.trueAnomaly,
      v.argPe,
      v.inc,
      v.lan,
      KERBIN_MU,
      0,
      { ...TARGET_200KM_CIRCULAR, inclinationDeg: 5 },
      0,
    );
    if (!seq) throw new Error("expected sequence");
    expect(seq.burns).toHaveLength(3);
    // First burn is the plane match — normal-only
    expect(seq.burns[0].prograde).toBe(0);
    expect(Math.abs(seq.burns[0].normal)).toBeGreaterThan(0);
    expect(seq.burns[0].radial).toBe(0);
    // Subsequent burns are the Hohmann, prograde-only
    expect(seq.burns[1].normal).toBe(0);
    expect(seq.burns[2].normal).toBe(0);
  });

  it("plane-match threshold is 0.5° — below that, no plane match", () => {
    const v = VESSEL_100KM_CIRCULAR_RICH;
    const seqLow = hohmannRendezvous(
      v,
      v.trueAnomaly,
      v.argPe,
      v.inc,
      v.lan,
      KERBIN_MU,
      0,
      { ...TARGET_200KM_CIRCULAR, inclinationDeg: 0.3 },
      0,
    );
    if (!seqLow) throw new Error("expected sequence");
    expect(seqLow.burns).toHaveLength(2);
  });

  it("burn 2 is half a transfer period after burn 1", () => {
    const v = VESSEL_100KM_CIRCULAR_RICH;
    const seq = hohmannRendezvous(
      v,
      v.trueAnomaly,
      v.argPe,
      v.inc,
      v.lan,
      KERBIN_MU,
      0,
      TARGET_200KM_CIRCULAR,
      0,
    );
    if (!seq) throw new Error("expected sequence");
    const transferSma = (KERBIN_R + 100_000 + (KERBIN_R + 200_000)) / 2;
    const halfPeriod = Math.PI * Math.sqrt(transferSma ** 3 / KERBIN_MU);
    const [b1, b2] = seq.burns;
    expect(b2.ut - b1.ut).toBeCloseTo(halfPeriod, 3);
  });

  it("standoff > 0 increases the wait (arrives behind target)", () => {
    const v = VESSEL_100KM_CIRCULAR_RICH;
    const noStandoff = hohmannRendezvous(
      v,
      v.trueAnomaly,
      v.argPe,
      v.inc,
      v.lan,
      KERBIN_MU,
      0,
      TARGET_200KM_CIRCULAR,
      0,
    );
    const withStandoff = hohmannRendezvous(
      v,
      v.trueAnomaly,
      v.argPe,
      v.inc,
      v.lan,
      KERBIN_MU,
      0,
      TARGET_200KM_CIRCULAR,
      500,
    );
    if (!noStandoff || !withStandoff) throw new Error("expected sequences");
    // Same Hohmann ΔV (standoff doesn't change radii, just timing)
    expect(withStandoff.burns[0].prograde).toBeCloseTo(
      noStandoff.burns[0].prograde,
      3,
    );
    // But burn 1 happens later (or at most a synodic period earlier — not equal)
    expect(withStandoff.burns[0].ut).not.toBe(noStandoff.burns[0].ut);
  });

  it("eccentric target rendezvous radius is target.PeR, not target.sma", () => {
    // Target with PeR = 150 km, ApR = 250 km (ecc = ~0.077).
    const peR = KERBIN_R + 150_000;
    const apR = KERBIN_R + 250_000;
    const eccTargetSma = (peR + apR) / 2;
    const eccTarget: typeof TARGET_200KM_CIRCULAR = {
      sma: eccTargetSma,
      PeR: peR,
      inclinationDeg: 0,
      lanDeg: 0,
      argPeDeg: 0,
      trueAnomalyDeg: 0,
      period: 2 * Math.PI * Math.sqrt(eccTargetSma ** 3 / KERBIN_MU),
    };
    const v = VESSEL_100KM_CIRCULAR_RICH;
    const seq = hohmannRendezvous(
      v,
      v.trueAnomaly,
      v.argPe,
      v.inc,
      v.lan,
      KERBIN_MU,
      0,
      eccTarget,
      0,
    );
    if (!seq) throw new Error("expected sequence");
    // Final orbit should be circular at PeR, not at SMA.
    expect(seq.finalProjected?.ApR).toBe(peR);
    expect(seq.finalProjected?.PeR).toBe(peR);
  });

  it("totalDeltaV sums all burns' magnitudes", () => {
    const v = VESSEL_100KM_CIRCULAR_RICH;
    const seq = hohmannRendezvous(
      v,
      v.trueAnomaly,
      v.argPe,
      v.inc,
      v.lan,
      KERBIN_MU,
      0,
      { ...TARGET_200KM_CIRCULAR, inclinationDeg: 5 },
      0,
    );
    if (!seq) throw new Error("expected sequence");
    const summed = seq.burns.reduce((s, b) => s + b.requiredDeltaV, 0);
    expect(seq.totalDeltaV).toBeCloseTo(summed, 6);
  });
});
