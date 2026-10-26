import { type OrbitElements, solve } from "@ksp-gonogo/sitrep-client";
import { describe, expect, it } from "vitest";
import {
  type BodyTransferPlan,
  ejectionVelocity,
  escapeAsymptote,
  escapeTimeToSoi,
  flybyImpactParameter,
  flybyPeriapsisRadius,
  nodeComponents,
  planMoonTransfer,
  planPlanetTransfer,
} from "./bodyTransfer";
import type { Vec3Tuple } from "./lambert";
import type { StateLike } from "./porkchop";

const rad = (deg: number) => (deg * Math.PI) / 180;

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;
const KERBIN_R = 600_000;
const KERBIN_SOI = 84_159_286;

const KERBIN: OrbitElements = {
  sma: 13_599_840_256,
  ecc: 0,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 3.14,
  epoch: 0,
  mu: KERBOL_MU,
};
const DUNA: OrbitElements = {
  sma: 20_726_155_264,
  ecc: 0.051,
  inc: rad(0.06),
  lan: rad(135.5),
  argPe: 0,
  meanAnomalyAtEpoch: 3.14,
  epoch: 0,
  mu: KERBOL_MU,
};
const MUN: OrbitElements = {
  sma: 12_000_000,
  ecc: 0,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 1.7,
  epoch: 0,
  mu: KERBIN_MU,
};
const MINMUS: OrbitElements = {
  sma: 47_000_000,
  ecc: 0,
  inc: rad(6),
  lan: rad(78),
  argPe: rad(38),
  meanAnomalyAtEpoch: 0.9,
  epoch: 0,
  mu: KERBIN_MU,
};

const periodOf = (e: OrbitElements) =>
  2 * Math.PI * Math.sqrt(e.sma ** 3 / e.mu);

const MUN_BODY = {
  state: (ut: number) => solve(MUN, ut),
  mu: 6.5138398e10,
  radius: 200_000,
  period: periodOf(MUN),
  soi: 2_429_559,
};
const MINMUS_BODY = {
  state: (ut: number) => solve(MINMUS, ut),
  mu: 1.7658e9,
  radius: 60_000,
  period: periodOf(MINMUS),
  soi: 2_247_428,
};

/** The craft in a circular 100 km orbit of Kerbin, inclined by `incDeg`. */
function craftOrbit(incDeg: number, phase = 0.4): OrbitElements {
  return {
    sma: KERBIN_R + 100_000,
    ecc: 0,
    inc: rad(incDeg),
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: phase,
    epoch: 0,
    mu: KERBIN_MU,
  };
}

const NOW = 1_000_000;

function moonPlan(moon: typeof MUN_BODY, craft = craftOrbit(0)) {
  return planMoonTransfer({
    mu: KERBIN_MU,
    craft: (ut) => solve(craft, ut),
    craftPeriod: periodOf(craft),
    nowUt: NOW,
    moon,
    periapsisAltitude: 100_000,
  });
}

const dot = (a: Vec3Tuple, b: Vec3Tuple) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3Tuple) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3Tuple): Vec3Tuple => {
  const n = norm(a);
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** The burn as a velocity change vector, rebuilt from its components in the craft's node basis. */
function burnVector(plan: BodyTransferPlan, craft: StateLike): Vec3Tuple {
  const p = unit(craft.velocity);
  const n = unit(cross(craft.position, craft.velocity));
  const r = cross(p, n);
  return [
    p[0] * plan.prograde + n[0] * plan.normal + r[0] * plan.radial,
    p[1] * plan.prograde + n[1] * plan.normal + r[1] * plan.radial,
    p[2] * plan.prograde + n[2] * plan.normal + r[2] * plan.radial,
  ];
}

/**
 * The closest the craft comes to the moon after the burn, with Kerbin's and the
 * moon's gravity both acting (RK4), which is the encounter the game's patched
 * conics approximate.
 */
function closestApproach(
  plan: BodyTransferPlan,
  craft: OrbitElements,
  moon: typeof MUN_BODY,
): number {
  const from = solve(craft, plan.burnUt);
  const dv = burnVector(plan, from);
  let r: Vec3Tuple = from.position;
  let v: Vec3Tuple = [
    from.velocity[0] + dv[0],
    from.velocity[1] + dv[1],
    from.velocity[2] + dv[2],
  ];
  let t = plan.burnUt;
  const end = plan.arrivalUt + 3_000;
  let closest = Number.POSITIVE_INFINITY;
  const accel = (pos: Vec3Tuple, ut: number): Vec3Tuple => {
    const m = moon.state(ut).position;
    const rel: Vec3Tuple = [pos[0] - m[0], pos[1] - m[1], pos[2] - m[2]];
    const d1 = norm(pos) ** 3;
    const d2 = norm(rel) ** 3;
    return [
      (-KERBIN_MU * pos[0]) / d1 - (moon.mu * rel[0]) / d2,
      (-KERBIN_MU * pos[1]) / d1 - (moon.mu * rel[1]) / d2,
      (-KERBIN_MU * pos[2]) / d1 - (moon.mu * rel[2]) / d2,
    ];
  };
  while (t < end) {
    const dist = norm([
      r[0] - moon.state(t).position[0],
      r[1] - moon.state(t).position[1],
      r[2] - moon.state(t).position[2],
    ]);
    closest = Math.min(closest, dist);
    const h = dist < 6_000_000 ? 2 : 20;
    const k1v = accel(r, t);
    const k1r = v;
    const r2: Vec3Tuple = [
      r[0] + (k1r[0] * h) / 2,
      r[1] + (k1r[1] * h) / 2,
      r[2] + (k1r[2] * h) / 2,
    ];
    const v2: Vec3Tuple = [
      v[0] + (k1v[0] * h) / 2,
      v[1] + (k1v[1] * h) / 2,
      v[2] + (k1v[2] * h) / 2,
    ];
    const k2v = accel(r2, t + h / 2);
    const r3: Vec3Tuple = [
      r[0] + (v2[0] * h) / 2,
      r[1] + (v2[1] * h) / 2,
      r[2] + (v2[2] * h) / 2,
    ];
    const v3: Vec3Tuple = [
      v[0] + (k2v[0] * h) / 2,
      v[1] + (k2v[1] * h) / 2,
      v[2] + (k2v[2] * h) / 2,
    ];
    const k3v = accel(r3, t + h / 2);
    const r4: Vec3Tuple = [
      r[0] + v3[0] * h,
      r[1] + v3[1] * h,
      r[2] + v3[2] * h,
    ];
    const v4: Vec3Tuple = [
      v[0] + k3v[0] * h,
      v[1] + k3v[1] * h,
      v[2] + k3v[2] * h,
    ];
    const k4v = accel(r4, t + h);
    r = [
      r[0] + (h / 6) * (v[0] + 2 * v2[0] + 2 * v3[0] + v4[0]),
      r[1] + (h / 6) * (v[1] + 2 * v2[1] + 2 * v3[1] + v4[1]),
      r[2] + (h / 6) * (v[2] + 2 * v2[2] + 2 * v3[2] + v4[2]),
    ];
    v = [
      v[0] + (h / 6) * (k1v[0] + 2 * k2v[0] + 2 * k3v[0] + k4v[0]),
      v[1] + (h / 6) * (k1v[1] + 2 * k2v[1] + 2 * k3v[1] + k4v[1]),
      v[2] + (h / 6) * (k1v[2] + 2 * k2v[2] + 2 * k3v[2] + k4v[2]),
    ];
    t += h;
  }
  return closest;
}

describe("transfer to a moon", () => {
  it("sends a 100 km Kerbin craft to the Mun for about 837 m/s, a single prograde burn", () => {
    const plan = moonPlan(MUN_BODY);
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.deltaV).toBeGreaterThan(825);
    expect(plan.deltaV).toBeLessThan(850);
    expect(plan.prograde).toBeGreaterThan(0.97 * plan.deltaV);
    expect(Math.abs(plan.normal)).toBeLessThan(5);
  });

  it("departs within the next orbit when the moon is in the craft's plane", () => {
    const plan = moonPlan(MUN_BODY);
    expect(plan?.burnUt).toBeGreaterThan(NOW);
    expect((plan?.burnUt ?? 0) - NOW).toBeLessThan(
      periodOf(craftOrbit(0)) * 1.1,
    );
  });

  it("takes about the Hohmann flight time", () => {
    const plan = moonPlan(MUN_BODY);
    const hohmann =
      Math.PI *
      Math.sqrt(((KERBIN_R + 100_000 + 12_000_000) / 2) ** 3 / KERBIN_MU);
    expect(plan?.transferTime).toBeGreaterThan(hohmann * 0.85);
    expect(plan?.transferTime).toBeLessThan(hohmann * 1.1);
  });

  it("aims for the periapsis asked for", () => {
    const plan = moonPlan(MUN_BODY);
    expect(plan?.periapsisAltitude).toBeGreaterThan(80_000);
    expect(plan?.periapsisAltitude).toBeLessThan(120_000);
  });

  it("gives the periapsis asked for to within a kilometre", () => {
    const plan = moonPlan(MUN_BODY);
    expect(Math.abs((plan?.periapsisAltitude ?? 0) - 100_000)).toBeLessThan(
      1_000,
    );
  });

  it("reaches the Mun's sphere of influence once Kerbin's and the Mun's gravity both act", () => {
    const craft = craftOrbit(0);
    const plan = moonPlan(MUN_BODY, craft);
    if (!plan) throw new Error("no Mun plan");
    expect(closestApproach(plan, craft, MUN_BODY)).toBeLessThan(MUN_BODY.soi);
  });

  it("sends the craft to Minmus for about 908 m/s", () => {
    const plan = moonPlan(MINMUS_BODY);
    expect(plan).not.toBeNull();
    expect(plan?.deltaV).toBeGreaterThan(895);
    expect(plan?.deltaV).toBeLessThan(925);
  });

  it("waits for Minmus's node rather than paying a 6 degree plane change, which is over 300 m/s", () => {
    const plan = moonPlan(MINMUS_BODY);
    expect(plan?.normal).toBeDefined();
    expect(Math.abs(plan?.normal ?? 0)).toBeLessThan(60);
  });

  it("reaches Minmus's sphere of influence under both gravities", () => {
    const craft = craftOrbit(0);
    const plan = moonPlan(MINMUS_BODY, craft);
    if (!plan) throw new Error("no Minmus plan");
    expect(closestApproach(plan, craft, MINMUS_BODY)).toBeLessThan(
      MINMUS_BODY.soi,
    );
  });

  it("answers null for a craft period of nothing", () => {
    expect(
      planMoonTransfer({
        mu: KERBIN_MU,
        craft: (ut) => solve(craftOrbit(0), ut),
        craftPeriod: 0,
        nowUt: NOW,
        moon: MUN_BODY,
        periapsisAltitude: 100_000,
      }),
    ).toBeNull();
  });
});

describe("transfer to another planet", () => {
  const craft = craftOrbit(0);
  const input = {
    muParent: KERBOL_MU,
    origin: {
      state: (ut: number) => solve(KERBIN, ut),
      mu: KERBIN_MU,
      soi: KERBIN_SOI,
      sma: KERBIN.sma,
      period: periodOf(KERBIN),
    },
    dest: {
      state: (ut: number) => solve(DUNA, ut),
      mu: 3.0136321e11,
      radius: 320_000,
      sma: DUNA.sma,
      period: periodOf(DUNA),
    },
    craft: (ut: number) => solve(craft, ut),
    craftPeriod: periodOf(craft),
    nowUt: NOW,
    periapsisAltitude: 100_000,
  };

  /** The Hohmann ejection burn from the 100 km orbit, worked from vis-viva alone. */
  function hohmannEjection(): number {
    const r1 = KERBIN.sma;
    const r2 = DUNA.sma;
    const vInf =
      Math.sqrt(KERBOL_MU / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
    const rp = KERBIN_R + 100_000;
    return (
      Math.sqrt(vInf * vInf + (2 * KERBIN_MU) / rp) - Math.sqrt(KERBIN_MU / rp)
    );
  }

  const plan = planPlanetTransfer(input);

  it("finds a Duna departure", () => {
    expect(plan).not.toBeNull();
  });

  it("costs within a few percent of the Hohmann ejection burn", () => {
    const hohmann = hohmannEjection();
    expect(hohmann).toBeGreaterThan(1000);
    expect(hohmann).toBeLessThan(1100);
    expect(plan?.deltaV).toBeGreaterThan(hohmann * 0.94);
    expect(plan?.deltaV).toBeLessThan(hohmann * 1.06);
  });

  it("is a mostly prograde burn", () => {
    expect(plan?.prograde).toBeGreaterThan(0.9 * (plan?.deltaV ?? Infinity));
  });

  it("departs within a synodic period and flies about the Hohmann time", () => {
    const synodic = 1 / Math.abs(1 / periodOf(KERBIN) - 1 / periodOf(DUNA));
    expect((plan?.burnUt ?? 0) - NOW).toBeLessThan(synodic * 1.06);
    const hohmann =
      Math.PI * Math.sqrt(((KERBIN.sma + DUNA.sma) / 2) ** 3 / KERBOL_MU);
    expect(plan?.transferTime).toBeGreaterThan(hohmann * 0.8);
    expect(plan?.transferTime).toBeLessThan(hohmann * 1.25);
  });

  it("leaves Kerbin along the asymptote the transfer arc needs", () => {
    if (!plan) throw new Error("no Duna plan");
    const from = solve(craft, plan.burnUt);
    const dv = burnVector(plan, from);
    const after: StateLike = {
      position: from.position,
      velocity: [
        from.velocity[0] + dv[0],
        from.velocity[1] + dv[1],
        from.velocity[2] + dv[2],
      ],
    };
    const leaving = escapeAsymptote(after, KERBIN_MU);
    expect(leaving).not.toBeNull();
    // Heliocentric speed after leaving: Kerbin's velocity plus the excess along the asymptote.
    expect(leaving?.excessSpeed).toBeGreaterThan(800);
    expect(leaving?.excessSpeed).toBeLessThan(1200);
  });

  it("aims for the periapsis asked for at Duna", () => {
    expect(plan?.periapsisAltitude).toBeGreaterThan(60_000);
    expect(plan?.periapsisAltitude).toBeLessThan(160_000);
  });
});

describe("the escape hyperbola", () => {
  it("takes the time to the sphere's edge that a numerical flight takes", () => {
    const rp = 700_000;
    const vInf = 1000;
    const soi = 5_000_000;
    // RK4 from periapsis, outward, until the radius reaches the sphere.
    let r: Vec3Tuple = [rp, 0, 0];
    let v: Vec3Tuple = [0, Math.sqrt(vInf * vInf + (2 * KERBIN_MU) / rp), 0];
    let t = 0;
    const h = 1;
    const accel = (p: Vec3Tuple): Vec3Tuple => {
      const d = norm(p) ** 3;
      return [
        (-KERBIN_MU * p[0]) / d,
        (-KERBIN_MU * p[1]) / d,
        (-KERBIN_MU * p[2]) / d,
      ];
    };
    while (norm(r) < soi) {
      const a1 = accel(r);
      const r2: Vec3Tuple = [r[0] + (v[0] * h) / 2, r[1] + (v[1] * h) / 2, 0];
      const v2: Vec3Tuple = [v[0] + (a1[0] * h) / 2, v[1] + (a1[1] * h) / 2, 0];
      const a2 = accel(r2);
      const r3: Vec3Tuple = [r[0] + (v2[0] * h) / 2, r[1] + (v2[1] * h) / 2, 0];
      const v3: Vec3Tuple = [v[0] + (a2[0] * h) / 2, v[1] + (a2[1] * h) / 2, 0];
      const a3 = accel(r3);
      const r4: Vec3Tuple = [r[0] + v3[0] * h, r[1] + v3[1] * h, 0];
      const v4: Vec3Tuple = [v[0] + a3[0] * h, v[1] + a3[1] * h, 0];
      const a4 = accel(r4);
      r = [
        r[0] + (h / 6) * (v[0] + 2 * v2[0] + 2 * v3[0] + v4[0]),
        r[1] + (h / 6) * (v[1] + 2 * v2[1] + 2 * v3[1] + v4[1]),
        0,
      ];
      v = [
        v[0] + (h / 6) * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0]),
        v[1] + (h / 6) * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1]),
        0,
      ];
      t += h;
    }
    expect(escapeTimeToSoi(KERBIN_MU, rp, vInf, soi)).toBeCloseTo(t, -1);
  });

  it("is no time at all where periapsis is outside the sphere", () => {
    expect(escapeTimeToSoi(KERBIN_MU, 9_000_000, 1000, 5_000_000)).toBe(0);
  });

  it("leaves along the asymptote the burn was solved for", () => {
    const position: Vec3Tuple = [700_000, 0, 0];
    const direction = unit([0.3, 0.9, 0.1]);
    const velocity = ejectionVelocity(
      position,
      direction,
      1200,
      KERBIN_MU,
      [0, 0, 1],
    );
    expect(velocity).not.toBeNull();
    if (!velocity) return;
    const leaving = escapeAsymptote({ position, velocity }, KERBIN_MU);
    expect(leaving?.excessSpeed).toBeCloseTo(1200, 3);
    expect(dot(leaving?.direction ?? [0, 0, 0], direction)).toBeCloseTo(1, 6);
  });

  it("refuses an asymptote only a retrograde hyperbola reaches", () => {
    expect(
      ejectionVelocity(
        [700_000, 0, 0],
        unit([0.3, -0.9, 0]),
        1200,
        KERBIN_MU,
        [0, 0, 1],
      ),
    ).toBeNull();
  });
});

describe("a flyby's periapsis", () => {
  it("inverts the impact parameter that gives it", () => {
    const b = flybyImpactParameter(6.5138398e10, 700, 300_000);
    expect(flybyPeriapsisRadius(6.5138398e10, 700, b)).toBeCloseTo(300_000, 3);
  });

  it("is the miss distance where gravity is negligible", () => {
    expect(flybyPeriapsisRadius(1, 1e6, 5_000)).toBeCloseTo(5_000, 3);
  });
});

describe("a burn in the node basis", () => {
  it("is prograde for a speed-up along the velocity", () => {
    const craft: StateLike = {
      position: [700_000, 0, 0],
      velocity: [0, 2246, 0],
    };
    const parts = nodeComponents(craft, [0, 100, 0]);
    expect(parts.prograde).toBeCloseTo(100, 9);
    expect(parts.normal).toBeCloseTo(0, 9);
    expect(parts.radial).toBeCloseTo(0, 9);
  });

  it("puts outward on radial and the orbit's pole on normal", () => {
    const craft: StateLike = {
      position: [700_000, 0, 0],
      velocity: [0, 2246, 0],
    };
    const parts = nodeComponents(craft, [5, 0, 7]);
    expect(parts.radial).toBeCloseTo(5, 9);
    expect(parts.normal).toBeCloseTo(7, 9);
  });
});
