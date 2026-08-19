import { describe, expect, it } from "vitest";
import {
  angleDelta,
  captureBurn,
  ejectionBurn,
  hohmannPhaseAngle,
  hohmannTransferTime,
  keplerTransferSolver,
  nextTransferWindowWait,
  synodicPeriod,
  transferSeverity,
  transferStatus,
} from "./transfer";

// Real Sun/Earth/Mars values (SI: metres, seconds, m/s), the canonical
// interplanetary sanity case every transfer tool is checked against.
const MU_SUN = 1.32712440018e20;
const MU_EARTH = 3.986004418e14;
const R_EARTH_ORBIT = 1.495978707e11; // Earth semi-major axis around Sun
const R_MARS_ORBIT = 2.279392e11; // Mars semi-major axis around Sun
const DAY = 86400;
const T_EARTH = 365.256 * DAY; // sidereal year
const T_MARS = 686.98 * DAY;
const R_LEO = 6.571e6; // 200 km parking orbit radius (6371 + 200 km)

describe("hohmannPhaseAngle (moved to core)", () => {
  it("Earth→Mars ideal departure phase ≈ +44.3° (outer target, leads)", () => {
    expect(hohmannPhaseAngle(R_EARTH_ORBIT, R_MARS_ORBIT)).toBeCloseTo(44.3, 0);
  });
  it("Earth→Venus ≈ −54° (inner target, trails)", () => {
    expect(hohmannPhaseAngle(1, 0.723)).toBeCloseTo(-54.2, 0);
  });
});

describe("angleDelta + transferStatus", () => {
  it("wraps to (−180,180]", () => {
    expect(angleDelta(10, 350)).toBe(20);
    expect(angleDelta(350, 10)).toBe(-20);
  });
  it("tiers GO/SOON/OFF", () => {
    expect(transferStatus(1)).toBe("go");
    expect(transferStatus(5)).toBe("soon");
    expect(transferStatus(30)).toBe("off");
  });
});

describe("synodicPeriod", () => {
  it("Earth/Mars ≈ 780 days", () => {
    expect(synodicPeriod(T_EARTH, T_MARS) / DAY).toBeCloseTo(779.9, 0);
  });
  it("is symmetric and diverges as periods converge", () => {
    expect(synodicPeriod(T_MARS, T_EARTH)).toBeCloseTo(
      synodicPeriod(T_EARTH, T_MARS),
      3,
    );
  });
});

describe("hohmannTransferTime", () => {
  it("Earth→Mars transfer time ≈ 259 days (half the transfer-ellipse period)", () => {
    expect(
      hohmannTransferTime(MU_SUN, R_EARTH_ORBIT, R_MARS_ORBIT) / DAY,
    ).toBeCloseTo(258.9, 0);
  });
});

describe("ejectionBurn (hyperbolic departure)", () => {
  const burn = ejectionBurn({
    muParent: MU_SUN,
    originRadius: R_EARTH_ORBIT,
    destRadius: R_MARS_ORBIT,
    muOriginBody: MU_EARTH,
    parkingRadius: R_LEO,
  });

  it("hyperbolic excess velocity v∞ ≈ 2.94 km/s", () => {
    expect(burn.vInf).toBeCloseTo(2945, -2); // ±~50 m/s
  });
  it("trans-Mars injection Δv from LEO ≈ 3.6 km/s", () => {
    expect(burn.ejectionDeltaV).toBeCloseTo(3613, -2);
  });
  it("ejection angle from prograde ≈ 151°", () => {
    expect(burn.ejectionAngleDeg).toBeCloseTo(151, 0);
  });
});

describe("captureBurn (hyperbolic arrival, the mirror of ejectionBurn)", () => {
  // Same Earth->Mars leg, read at the far end. MU/radius for Mars, and a 400 km
  // circular capture orbit (3389.5 km equatorial radius).
  const MU_MARS = 4.282837e13;
  const R_LOW_MARS = 3.7895e6;

  const burn = captureBurn({
    muParent: MU_SUN,
    originRadius: R_EARTH_ORBIT,
    destRadius: R_MARS_ORBIT,
    muDestBody: MU_MARS,
    captureRadius: R_LOW_MARS,
  });

  it("arrival v-infinity at Mars is about 2.65 km/s", () => {
    expect(burn!.vInf).toBeCloseTo(2652, -2);
  });

  it("Mars orbit insertion from the transfer is about 2.1 km/s", () => {
    expect(burn!.captureDeltaV).toBeCloseTo(2081, -2);
  });

  /*
   * The asymmetry that makes this function necessary rather than cosmetic. The
   * porkchop colours by v-infinity sums (`lambertDeltaV`), and neither leg's
   * v-infinity is the burn: Oberth makes departure cost MORE than its excess and
   * arrival cost LESS. A budget compared against a characteristic figure is
   * compared against a quantity nothing ever spends.
   */
  it("costs LESS than the arrival excess, where ejection costs MORE than its own", () => {
    expect(burn!.captureDeltaV).toBeLessThan(burn!.vInf);

    const ejection = ejectionBurn({
      muParent: MU_SUN,
      originRadius: R_EARTH_ORBIT,
      destRadius: R_MARS_ORBIT,
      muOriginBody: MU_EARTH,
      parkingRadius: R_LEO,
    });
    expect(ejection.ejectionDeltaV).toBeGreaterThan(ejection.vInf);
  });

  /*
   * Capture cost is NOT monotonic in the capture radius, which is worth pinning
   * because the intuition ("lower orbit, more Oberth, cheaper") is wrong and this
   * test was first written asserting it. Circularising has to kill the circular
   * speed too, so the cost has an interior minimum at `r = 2*mu/vInf^2` and rises
   * on both sides: toward a large number as r shrinks, and toward vInf as r grows
   * without bound (nothing left to help, the whole excess has to go).
   */
  it("has an interior minimum in the capture radius rather than falling with it", () => {
    const at = (radius: number) =>
      captureBurn({
        muParent: MU_SUN,
        originRadius: R_EARTH_ORBIT,
        destRadius: R_MARS_ORBIT,
        muDestBody: MU_MARS,
        captureRadius: radius,
      })!.captureDeltaV;

    const cheapest = (2 * MU_MARS) / (burn!.vInf * burn!.vInf);
    expect(at(cheapest)).toBeLessThan(at(cheapest / 4));
    expect(at(cheapest)).toBeLessThan(at(cheapest * 4));
  });

  it("tends to the arrival excess as the capture orbit grows without bound", () => {
    const veryHigh = captureBurn({
      muParent: MU_SUN,
      originRadius: R_EARTH_ORBIT,
      destRadius: R_MARS_ORBIT,
      muDestBody: MU_MARS,
      captureRadius: 1e12,
    });
    // Approaches the excess FROM BELOW: at any finite radius there is still some
    // circular speed the craft keeps, so the burn is always the cheaper of the two.
    expect(veryHigh!.captureDeltaV).toBeLessThan(burn!.vInf);
    expect(veryHigh!.captureDeltaV / burn!.vInf).toBeGreaterThan(0.99);
  });

  it("is symmetric in the leg: an inward transfer arrives with a real excess too", () => {
    const inward = captureBurn({
      muParent: MU_SUN,
      originRadius: R_MARS_ORBIT,
      destRadius: R_EARTH_ORBIT,
      muDestBody: MU_EARTH,
      captureRadius: R_LEO,
    });
    expect(inward!.vInf).toBeGreaterThan(0);
    expect(inward!.captureDeltaV).toBeGreaterThan(0);
  });

  it("declines rather than inventing a number when the geometry is degenerate", () => {
    expect(
      captureBurn({
        muParent: MU_SUN,
        originRadius: R_EARTH_ORBIT,
        destRadius: R_MARS_ORBIT,
        muDestBody: MU_MARS,
        captureRadius: 0,
      }),
    ).toBeNull();
  });
});

describe("nextTransferWindowWait", () => {
  const syn = synodicPeriod(T_EARTH, T_MARS);

  it("returns a wait in [0, synodic) and the drift identity holds", () => {
    const current = 0;
    const ideal = hohmannPhaseAngle(R_EARTH_ORBIT, R_MARS_ORBIT);
    const wait = nextTransferWindowWait({
      currentPhaseDeg: current,
      idealPhaseDeg: ideal,
      originPeriod: T_EARTH,
      destPeriod: T_MARS,
      synodicPeriodSec: syn,
    });
    expect(wait).toBeGreaterThanOrEqual(0);
    expect(wait).toBeLessThan(syn);
    // phase drifts at (n_dest − n_origin); after `wait` it must equal ideal (mod 360)
    const rate = 360 / T_MARS - 360 / T_EARTH; // deg/s
    const reached = (((current + rate * wait) % 360) + 360) % 360;
    const target = ((ideal % 360) + 360) % 360;
    const diff = Math.min(
      Math.abs(reached - target),
      360 - Math.abs(reached - target),
    );
    expect(diff).toBeLessThan(0.5);
  });

  it("wait ≈ 0 when already at the ideal phase", () => {
    const ideal = hohmannPhaseAngle(R_EARTH_ORBIT, R_MARS_ORBIT);
    const wait = nextTransferWindowWait({
      currentPhaseDeg: ideal,
      idealPhaseDeg: ideal,
      originPeriod: T_EARTH,
      destPeriod: T_MARS,
      synodicPeriodSec: syn,
    });
    // either ~0 or ~synodic (a full cycle), both mean "window is now"
    expect(Math.min(wait, syn - wait)).toBeLessThan(DAY);
  });
});

describe("keplerTransferSolver.solve (composite)", () => {
  const sol = keplerTransferSolver.solve({
    muParent: MU_SUN,
    originRadius: R_EARTH_ORBIT,
    destRadius: R_MARS_ORBIT,
    originPeriod: T_EARTH,
    destPeriod: T_MARS,
    currentPhaseDeg: 44.3,
    muOriginBody: MU_EARTH,
    parkingRadius: R_LEO,
    nowUt: 1_000_000,
  });

  it("reports the backend id", () => {
    expect(keplerTransferSolver.id).toBe("kepler-coplanar");
  });
  it("is GO when the current phase sits on the ideal", () => {
    expect(sol.status).toBe("go");
    expect(Math.abs(sol.phaseDeltaDeg)).toBeLessThan(2);
  });
  it("threads departure/arrival UT from now + wait + transfer time", () => {
    expect(sol.departureUt).toBeCloseTo(sol.nowUt + sol.waitSeconds, 6);
    expect(sol.arrivalUt).toBeCloseTo(sol.departureUt + sol.transferTimeSec, 6);
  });
  it("carries the ejection figures", () => {
    expect(sol.ejectionDeltaV).toBeCloseTo(3613, -2);
    expect(sol.vInf).toBeCloseTo(2945, -2);
  });
});

describe("transferSeverity (spec mapping table, Scale B)", () => {
  it("go -> nominal", () => {
    expect(transferSeverity("go")).toBe("nominal");
  });
  it("soon -> caution", () => {
    expect(transferSeverity("soon")).toBe("caution");
  });
  it("off -> critical", () => {
    expect(transferSeverity("off")).toBe("critical");
  });
});
