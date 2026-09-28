import { type OrbitPatch, TransitionType } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  findImpactPoint,
  geoFromInertial,
  groundTrackSamples,
  isPatchElliptical,
  patchArc,
  patchHolds,
  patchStateAt,
  ROTATION_PERIOD_SECONDS,
} from "./orbit-patches";
import { type WireOf, wrapWire } from "./stub-transport";

function wirePatch(overrides: Partial<WireOf<OrbitPatch>> = {}): OrbitPatch {
  // Wire-shaped, then wrapped: `OrbitPatch` is a nested contract shape and the decode gives its declared quantities their units.
  return wrapWire<OrbitPatch>("OrbitPatch", {
    sma: 700_000,
    ecc: 0.1,
    inc: 15,
    lan: 30,
    argPe: 45,
    meanAnomalyAtEpoch: 0.5,
    epoch: 100,
    period: 2000,
    startUt: 0,
    endUt: 5000,
    patchStartTransition: 0,
    patchEndTransition: 1,
    peA: 90_000,
    apA: 240_000,
    semiLatusRectum: 690_000,
    semiMinorAxis: 695_000,
    referenceBody: "Kerbin",
    closestEncounterBody: null,
    ...overrides,
  });
}

/** A circular equatorial orbit of 1 Mm and a 100 s period around Kerbin, open for a million seconds. */
function circular(overrides: Partial<WireOf<OrbitPatch>> = {}): OrbitPatch {
  return wirePatch({
    sma: 1_000_000,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
    period: 100,
    startUt: 0,
    endUt: 1_000_000,
    ...overrides,
  });
}

describe("patchStateAt", () => {
  it("places the vessel at periapsis (+x) at epoch", () => {
    const state = patchStateAt(circular(), 0);
    expect(state.x).toBeCloseTo(1_000_000, 5);
    expect(state.y).toBeCloseTo(0, 5);
    expect(state.z).toBeCloseTo(0, 5);
  });

  it("traces a quarter-orbit in a quarter-period", () => {
    const q = patchStateAt(circular(), 25);
    expect(q.x).toBeCloseTo(0, 2);
    expect(q.y).toBeCloseTo(1_000_000, 2);
  });

  it("keeps z = 0 for a zero-inclination orbit at every time", () => {
    for (const ut of [1, 10, 50, 99]) {
      expect(patchStateAt(circular(), ut).z).toBeCloseTo(0, 2);
    }
  });

  it("lifts the vessel out of the equator on an inclined orbit", () => {
    const q = patchStateAt(circular({ inc: 45 }), 25);
    expect(Math.abs(q.z)).toBeGreaterThan(100_000);
  });

  it("puts the radius at sma(1 - e cos E)", () => {
    // At epoch M = 0, so E = 0 and r = sma(1 - e).
    const state = patchStateAt(circular({ ecc: 0.2 }), 0);
    expect(state.radius).toBeCloseTo(800_000, 2);
  });
});

describe("geoFromInertial", () => {
  it("places (r, 0, 0) at lat 0, lon 0", () => {
    const geo = geoFromInertial({ x: 1_000, y: 0, z: 0, radius: 1_000 }, 500);
    expect(geo.lat).toBeCloseTo(0, 10);
    expect(geo.lonInertial).toBeCloseTo(0, 10);
    expect(geo.alt).toBeCloseTo(500, 10);
  });

  it("places (0, r, 0) at lon 90", () => {
    const geo = geoFromInertial({ x: 0, y: 1_000, z: 0, radius: 1_000 }, 0);
    expect(geo.lonInertial).toBeCloseTo(90, 10);
  });

  it("places (0, 0, r) at the north pole", () => {
    const geo = geoFromInertial({ x: 0, y: 0, z: 1_000, radius: 1_000 }, 0);
    expect(geo.lat).toBeCloseTo(90, 10);
  });
});

describe("isPatchElliptical", () => {
  it("propagates a closed orbit and refuses an open one", () => {
    expect(isPatchElliptical(circular())).toBe(true);
    expect(
      isPatchElliptical(
        circular({ ecc: 1.5, period: Number.POSITIVE_INFINITY }),
      ),
    ).toBe(false);
  });
});

describe("patchHolds", () => {
  it("holds for its window, ends included", () => {
    const patch = circular({ startUt: 10, endUt: 20 });
    expect(patchHolds(patch, 10)).toBe(true);
    expect(patchHolds(patch, 20)).toBe(true);
    expect(patchHolds(patch, 9)).toBe(false);
    expect(patchHolds(patch, 21)).toBe(false);
  });
});

describe("patchArc", () => {
  it("spans the window in even steps, ends included", () => {
    const arc = patchArc(circular({ startUt: 0, endUt: 100 }), 4);
    expect(arc.map((p) => p.ut)).toEqual([0, 25, 50, 75, 100]);
    expect(arc[1].state.y).toBeCloseTo(1_000_000, 2);
  });

  it("begins no earlier than the instant it is given", () => {
    const arc = patchArc(circular({ startUt: 0, endUt: 100 }), 2, 50);
    expect(arc.map((p) => p.ut)).toEqual([50, 75, 100]);
  });

  it("is empty once the window has passed", () => {
    expect(patchArc(circular({ startUt: 0, endUt: 100 }), 2, 100)).toEqual([]);
  });
});

describe("groundTrackSamples", () => {
  const ref = { ut: 0, lat: 0, lon: 0 };

  it("lands the first sample on the observed longitude", () => {
    const [first] = groundTrackSamples(
      [circular()],
      "Kerbin",
      600_000,
      1_000,
      { ut: 0, lat: 0, lon: 40 },
      10,
      1,
    );
    expect(first.lon).toBeCloseTo(40, 5);
  });

  it("turns the surface under the track at the sidereal rate", () => {
    // A 1000 s orbit moves 3.6 degrees in 10 s while a 100 s day turns the surface 36.
    const samples = [
      ...groundTrackSamples(
        [circular({ period: 1_000 })],
        "Kerbin",
        600_000,
        100,
        ref,
        10,
        10,
      ),
    ];
    expect(samples.at(-1)?.lon).toBeCloseTo(3.6 - 36, 5);
  });

  it("stops at the first patch around another body", () => {
    const samples = [
      ...groundTrackSamples(
        [
          circular({ endUt: 50, patchEndTransition: TransitionType.Encounter }),
          circular({
            referenceBody: "Mun",
            startUt: 50,
            endUt: 200,
            patchStartTransition: TransitionType.Encounter,
          }),
          circular({
            startUt: 200,
            endUt: 400,
            patchStartTransition: TransitionType.Escape,
          }),
        ],
        "Kerbin",
        600_000,
        1_000_000,
        ref,
        400,
        10,
      ),
    ];
    expect(samples.at(-1)?.ut).toBe(50);
    expect(samples.every((s) => s.patchIndex === 0)).toBe(true);
  });
});

describe("findImpactPoint", () => {
  // Short synthetic period so apoapsis→periapsis (half a period) is a small,
  // easy-to-bound horizon. `sma`/`ecc` chosen so periapsis radius (100_000)
  // sits well below the 200_000 body radius and apoapsis (400_000) well
  // above it.
  const CROSSING_PATCH = wirePatch({
    startUt: 0,
    endUt: 100,
    ecc: 0.6,
    inc: 0,
    lan: 0,
    argPe: 0,
    epoch: 0,
    period: 12,
    sma: 250_000,
    meanAnomalyAtEpoch: Math.PI, // apoapsis at t=0
  });

  it("returns the last pre-surface sample when the patch crosses the surface", () => {
    const impact = findImpactPoint(
      [CROSSING_PATCH],
      "Kerbin",
      200_000,
      21549.425,
      { ut: 0, lat: 0, lon: 0 },
      10,
      0.5,
    );
    expect(impact).not.toBeNull();
    expect(Number.isFinite(impact?.lat)).toBe(true);
    expect(Number.isFinite(impact?.lon)).toBe(true);
  });

  it("returns null when the patch never dips below the surface within the horizon", () => {
    const CIRCULAR = wirePatch({
      startUt: 0,
      endUt: 100,
      ecc: 0,
      inc: 0,
      lan: 0,
      argPe: 0,
      epoch: 0,
      period: 12,
      sma: 250_000,
      meanAnomalyAtEpoch: 0,
    });
    const impact = findImpactPoint(
      [CIRCULAR],
      "Kerbin",
      200_000,
      21549.425,
      { ut: 0, lat: 0, lon: 0 },
      10,
      0.5,
    );
    expect(impact).toBeNull();
  });

  it("returns null for an empty patch list", () => {
    expect(
      findImpactPoint(
        [],
        "Kerbin",
        200_000,
        21549.425,
        { ut: 0, lat: 0, lon: 0 },
        10,
        1,
      ),
    ).toBeNull();
  });

  it("returns null when no patch matches the requested body", () => {
    const impact = findImpactPoint(
      [CROSSING_PATCH],
      "Mun",
      200_000,
      138984.38,
      { ut: 0, lat: 0, lon: 0 },
      10,
      0.5,
    );
    expect(impact).toBeNull();
  });

  it("returns null for a non-positive horizon or step", () => {
    expect(
      findImpactPoint(
        [CROSSING_PATCH],
        "Kerbin",
        200_000,
        21549.425,
        { ut: 0, lat: 0, lon: 0 },
        0,
        0.5,
      ),
    ).toBeNull();
    expect(
      findImpactPoint(
        [CROSSING_PATCH],
        "Kerbin",
        200_000,
        21549.425,
        { ut: 0, lat: 0, lon: 0 },
        10,
        0,
      ),
    ).toBeNull();
  });
});

describe("ROTATION_PERIOD_SECONDS", () => {
  it("carries an entry for every stock body", () => {
    for (const body of [
      "Kerbol",
      "Moho",
      "Eve",
      "Gilly",
      "Kerbin",
      "Mun",
      "Minmus",
      "Duna",
      "Ike",
      "Dres",
      "Jool",
      "Laythe",
      "Vall",
      "Tylo",
      "Bop",
      "Pol",
      "Eeloo",
    ]) {
      expect(ROTATION_PERIOD_SECONDS[body]).toBeGreaterThan(0);
    }
  });
});
