import { describe, expect, it } from "vitest";
import type { OrbitElements } from "./kepler";
import { solve } from "./kepler";
import {
  buildOrbitPatches,
  closestApproach,
  orbitalPeriod,
  previewManeuver,
  rvToElements,
} from "./propagation";

/**
 * Unit coverage for the client-side orbit derivations (`propagation.ts`):
 * closest-approach solve (`o.closestTgtApprUT`), state-vector→elements
 * round-trip + post-burn maneuver preview (`o.maneuverNodes`), and the
 * patched-conic chain reconstruction (`o.orbitPatches`). All bottom out in
 * `kepler.solve`, which the golden fixtures already pin against C#.
 */

const MU_KERBIN = 3.5316e12;

/** A circular equatorial orbit of the given radius, phased by `mAtEpoch`. */
function circular(radius: number, mAtEpoch = 0): OrbitElements {
  return {
    sma: radius,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: mAtEpoch,
    epoch: 0,
    mu: MU_KERBIN,
  };
}

describe("orbitalPeriod", () => {
  it("matches 2π·sqrt(sma³/mu)", () => {
    const els = circular(700_000);
    const expected = 2 * Math.PI * Math.sqrt(700_000 ** 3 / MU_KERBIN);
    expect(orbitalPeriod(els)).toBeCloseTo(expected, 3);
  });

  it("is null for a non-bound sma", () => {
    expect(orbitalPeriod({ ...circular(700_000), sma: -1 })).toBeNull();
  });
});

describe("closestApproach", () => {
  it("returns ~zero separation for two identical, co-phased orbits", () => {
    const orbit = circular(800_000);
    const result = closestApproach(orbit, orbit, 0);
    expect(result).not.toBeNull();
    expect((result as { distance: number }).distance).toBeLessThan(1);
  });

  it("finds the minimum separation of two co-orbital but phase-shifted orbits", () => {
    // Same radius/period, target a quarter-orbit ahead — separation is
    // constant over time (co-orbital), so closest approach is the fixed chord
    // length 2·r·sin(Δθ/2) with Δθ = π/2.
    const radius = 800_000;
    const self = circular(radius, 0);
    const target = circular(radius, Math.PI / 2);
    const result = closestApproach(self, target, 0);
    expect(result).not.toBeNull();
    const expectedChord = 2 * radius * Math.sin(Math.PI / 4);
    expect((result as { distance: number }).distance).toBeCloseTo(
      expectedChord,
      -1,
    );
  });

  it("drives the separation of two different-radius orbits toward the radius gap at conjunction", () => {
    const self = circular(700_000);
    const target = circular(900_000);
    const result = closestApproach(self, target, 0);
    expect(result).not.toBeNull();
    // The minimum over a synodic period is when they line up radially: 200 km.
    expect((result as { distance: number }).distance).toBeLessThan(210_000);
    expect((result as { distance: number }).distance).toBeGreaterThan(190_000);
  });

  it("returns null for a degenerate orbit", () => {
    const bad = { ...circular(700_000), sma: 0 };
    expect(closestApproach(bad, circular(800_000), 0)).toBeNull();
  });
});

describe("rvToElements round-trips solve", () => {
  const cases: Array<[string, OrbitElements, number]> = [
    ["circular equatorial", circular(700_000), 1234],
    [
      "eccentric inclined",
      {
        sma: 1_200_000,
        ecc: 0.35,
        inc: 0.5,
        lan: 1.1,
        argPe: 0.7,
        meanAnomalyAtEpoch: 0.9,
        epoch: 0,
        mu: MU_KERBIN,
      },
      3600,
    ],
  ];

  for (const [name, els, ut] of cases) {
    it(name, () => {
      const state = solve(els, ut);
      const back = rvToElements(state.position, state.velocity, els.mu, ut);
      expect(back.bound).toBe(true);
      // Re-propagate the recovered elements at the same UT — the position must
      // match, which is the property that actually matters downstream.
      const reState = solve(back, ut);
      for (let i = 0; i < 3; i++) {
        const scaleF = Math.max(Math.abs(state.position[i]), 1);
        expect(
          Math.abs(reState.position[i] - state.position[i]) / scaleF,
        ).toBeLessThan(1e-6);
      }
      expect(back.sma).toBeCloseTo(els.sma, 0);
      expect(back.ecc).toBeCloseTo(els.ecc, 6);
    });
  }
});

describe("previewManeuver", () => {
  it("a prograde burn at periapsis raises apoapsis, leaving periapsis unchanged", () => {
    // Start on a circular orbit; a prograde burn raises the far side.
    const radius = 700_000;
    const els = circular(radius);
    const preview = previewManeuver(els, {
      ut: 0,
      dvRadial: 0,
      dvNormal: 0,
      dvPrograde: 200,
    });
    expect(preview.bound).toBe(true);
    expect(preview.periapsisRadius).not.toBeNull();
    expect(preview.apoapsisRadius).not.toBeNull();
    // Periapsis stays ~at the burn radius; apoapsis climbs above it.
    expect(preview.periapsisRadius as number).toBeCloseTo(radius, -2);
    expect(preview.apoapsisRadius as number).toBeGreaterThan(radius + 1000);
  });

  it("a normal burn tilts the orbit plane (raises inclination)", () => {
    const els = circular(700_000);
    const preview = previewManeuver(els, {
      ut: 0,
      dvRadial: 0,
      dvNormal: 300,
      dvPrograde: 0,
    });
    expect(preview.inclinationDeg).not.toBeNull();
    expect(preview.inclinationDeg as number).toBeGreaterThan(0.5);
  });

  it("a large prograde burn produces an escape trajectory (no apoapsis)", () => {
    const els = circular(700_000);
    const preview = previewManeuver(els, {
      ut: 0,
      dvRadial: 0,
      dvNormal: 0,
      dvPrograde: 5000,
    });
    expect(preview.bound).toBe(false);
    expect(preview.apoapsisRadius).toBeNull();
  });

  it("returns an empty preview for a degenerate pre-burn orbit", () => {
    const preview = previewManeuver(
      { ...circular(700_000), sma: 0 },
      { ut: 0, dvRadial: 0, dvNormal: 0, dvPrograde: 100 },
    );
    expect(preview.elements).toBeNull();
    expect(preview.bound).toBe(false);
  });
});

describe("buildOrbitPatches", () => {
  it("produces one closed-orbit patch over a full period when there is no encounter", () => {
    const els = circular(700_000);
    const patches = buildOrbitPatches(
      { elements: els, referenceBodyIndex: 1 },
      0,
      { samples: 64 },
    );
    expect(patches).toHaveLength(1);
    expect(patches[0].points).toHaveLength(64);
    expect(patches[0].endTransition).toBeNull();
    const period = orbitalPeriod(els) as number;
    expect(patches[0].endUt).toBeCloseTo(period, 3);
  });

  it("terminates the patch at the encounter UT and carries the transition", () => {
    const els = circular(700_000);
    const patches = buildOrbitPatches(
      {
        elements: els,
        referenceBodyIndex: 1,
        encounter: { transitionType: 2, transitionUt: 500, bodyIndex: 4 },
      },
      0,
    );
    expect(patches[0].endUt).toBe(500);
    expect(patches[0].endTransition).toEqual({
      transitionType: 2,
      transitionUt: 500,
      bodyIndex: 4,
    });
  });

  it("ignores an encounter already in the past", () => {
    const els = circular(700_000);
    const patches = buildOrbitPatches(
      {
        elements: els,
        referenceBodyIndex: 1,
        encounter: { transitionType: 2, transitionUt: -10, bodyIndex: 4 },
      },
      0,
    );
    expect(patches[0].endTransition).toBeNull();
  });
});
