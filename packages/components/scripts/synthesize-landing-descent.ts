#!/usr/bin/env tsx
/**
 * Synthesize a physically-grounded Mun descent and emit (a) a 1 Hz SYNTHETIC
 * time-series ndjson for the record, and (b) three `_stream` render fixtures
 * (high / ignition / final) for the Landing widget render harness.
 *
 * The trajectory is integrated forward with the widget's OWN full-vector burn
 * solve (`solveSuicideBurn`) driving when the suicide burn starts, so the data
 * is self-consistent with what the widget re-derives. Terrain (slope / roughness
 * / biome at the predicted point) is swept from rough-and-steep high up to
 * smooth-and-flat near touchdown, so the reticle's hazard verdict walks
 * DIVERT -> MARGINAL -> SAFE across the descent — a real UX story, not random.
 *
 * NOT captured — model-generated. Run:
 *   pnpm --filter @ksp-gonogo/components exec tsx scripts/synthesize-landing-descent.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { solveSuicideBurn } from "../src/LandingStatus/solveLanding";

// ── Mun ──────────────────────────────────────────────────────────────────────
const MU = 6.5138398e10;
const R = 200_000;
const MASS = 5; // tonnes
const THRUST = 18; // kN -> aMax = 3.6 m/s^2, TWR ~= 2.2 at the surface
const START_LAT = 0.0;
const START_LON = 0.0;
const DEG = Math.PI / 180;

interface Frame {
  t: number;
  aglMeters: number;
  vDown: number;
  vHoriz: number;
  lat: number;
  lon: number;
  burning: boolean;
}

/** Integrate a deorbit-to-touchdown descent at 1 Hz. */
function integrate(): Frame[] {
  const dt = 1;
  let agl = 8000; // m above terrain
  let vDown = 25; // m/s, descending
  let vHoriz = 160; // m/s, mostly-horizontal orbital leftover
  const lat = START_LAT;
  let lon = START_LON;
  let committed = false; // once the suicide burn starts it stays on (no un-commit)
  const frames: Frame[] = [];

  for (let t = 0; t < 300 && agl > 0; t++) {
    const r = R + agl;
    const g = MU / (r * r);
    const solution = solveSuicideBurn({
      heightFromTerrain: agl,
      altitudeAsl: agl,
      verticalSpeed: -vDown,
      surfaceSpeed: Math.sqrt(vDown * vDown + vHoriz * vHoriz),
      mu: MU,
      bodyRadius: R,
      availableThrust: THRUST,
      totalMass: MASS,
    });
    // Burn once the full-vector burn no longer fits the remaining altitude —
    // solveSuicideBurn signals that with ignitionAltitude <= 0 ("ignite now").
    // Latch it: a real suicide burn stays committed through touchdown rather
    // than un-committing into freefall the instant the solve says it fits again.
    if (solution.ignitionAltitude != null && solution.ignitionAltitude <= 0)
      committed = true;
    const burning = committed;

    frames.push({ t, aglMeters: agl, vDown, vHoriz, lat, lon, burning });

    const aMax = THRUST / MASS;
    if (burning) {
      // Guided suicide burn: null lateral drift first (real landers kill
      // horizontal, then descend), and hold the descent rate on a constant-net-
      // deceleration profile that reaches ~0 at the ground, easing to a gentle
      // final approach below 150 m so the touchdown is genuinely soft.
      vHoriz *= 0.85;
      let targetVDown = Math.sqrt(
        2 * Math.max(0.1, aMax - g) * Math.max(agl, 0),
      );
      if (agl < 400) {
        targetVDown = Math.min(targetVDown, 1.0 + agl / 100);
        vHoriz = Math.min(vHoriz, 0.3 + agl / 400);
      }
      vDown = Math.min(vDown + g * dt, targetVDown);
    } else {
      vDown += g * dt; // freefall
    }
    // Advance downrange (east) by the horizontal travel this step.
    const eastMeters = vHoriz * dt;
    lon += eastMeters / (R * Math.cos(lat * DEG)) / DEG;
    agl -= vDown * dt;
    if (agl < 0) agl = 0;
  }
  return frames;
}

// ── Terrain sweep: rough/steep high, smooth/flat low ──────────────────────────
function terrainFor(aglMeters: number): {
  slope: number;
  heading: number;
  roughness: number;
  biome: string;
} {
  if (aglMeters > 5000)
    return { slope: 20, heading: 135, roughness: 260, biome: "Midlands" };
  if (aglMeters > 120)
    return { slope: 9, heading: 110, roughness: 130, biome: "Midlands" };
  return { slope: 3, heading: 80, roughness: 28, biome: "Lowlands" };
}

/**
 * A plausible NxN terrain-height grid (metres, relative) for the reticle relief:
 * a plane tilted by the site slope along its downhill heading, plus a crater dip
 * and a ridge, plus fine deterministic texture. Deterministic (no RNG) so renders
 * are stable.
 */
function terrainPatchGrid(slopeDeg: number, headingDeg: number): number[] {
  const n = 16;
  const extent = 200; // metres the patch spans
  const cell = extent / n;
  const slopeRad = slopeDeg * DEG;
  const de = Math.sin(headingDeg * DEG); // downhill east component
  const dn = Math.cos(headingDeg * DEG); // downhill north component
  const grid = new Array<number>(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const east = (c - (n - 1) / 2) * cell;
      const north = ((n - 1) / 2 - r) * cell;
      // Tilted plane: elevation falls in the downhill direction.
      let h = -(east * de + north * dn) * Math.tan(slopeRad);
      // A crater dip in one quadrant, a ridge in the other.
      const cd =
        ((east - extent * 0.2) ** 2 + (north - extent * 0.15) ** 2) /
        (2 * (extent * 0.18) ** 2);
      h -= 18 * Math.exp(-cd);
      const rd =
        ((east + extent * 0.25) ** 2 + (north + extent * 0.2) ** 2) /
        (2 * (extent * 0.22) ** 2);
      h += 12 * Math.exp(-rd);
      // Fine, deterministic surface texture.
      h += 2.5 * Math.sin(east * 0.15) * Math.cos(north * 0.13);
      grid[r * n + c] = h;
    }
  }
  return grid;
}

/** The predicted touchdown point: current point + remaining downrange travel. */
function predictedPoint(f: Frame): { lat: number; lon: number } {
  const vSurf = Math.sqrt(f.vDown * f.vDown + f.vHoriz * f.vHoriz);
  const g = MU / (R + f.aglMeters) ** 2;
  const tImpact =
    vSurf > 0
      ? (-f.vDown + Math.sqrt(f.vDown ** 2 + 2 * g * f.aglMeters)) / g
      : 0;
  const downrange = f.vHoriz * tImpact * 0.5; // ~mean horizontal travel to impact
  const dLon = downrange / (R * Math.cos(f.lat * DEG)) / DEG;
  return { lat: f.lat, lon: f.lon + dLon };
}

function channelsFor(f: Frame, oneWaySeconds: number): Record<string, unknown> {
  const vSurf = Math.sqrt(f.vDown * f.vDown + f.vHoriz * f.vHoriz);
  const terrain = terrainFor(f.aglMeters);
  const pp = predictedPoint(f);
  return {
    "system.bodies": {
      bodies: [
        { name: "Mun", index: 3, parentIndex: 0, radius: R, orbit: null },
      ],
    },
    "vessel.identity": {
      vesselId: "synthetic-lander",
      name: "Synthetic Lander",
      vesselType: 0,
      situation: 0,
      parentBodyIndex: 3,
      launchUt: null,
    },
    "vessel.orbit": {
      referenceBodyIndex: 3,
      sma: 250_000,
      ecc: 0.02,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 10,
      mu: MU,
    },
    "vessel.flight": {
      latitude: f.lat,
      longitude: f.lon,
      altitudeAsl: f.aglMeters,
      altitudeTerrain: f.aglMeters,
      verticalSpeed: -f.vDown,
      surfaceSpeed: vSurf,
      orbitalSpeed: vSurf,
      atmDensity: 0,
    },
    "vessel.surface": {
      biome: terrain.biome,
      landedAt: null,
      heightFromTerrain: f.aglMeters,
    },
    "vessel.propulsion": {
      totalMass: MASS,
      dryMass: 3,
      currentThrust: f.burning ? THRUST : 0,
      availableThrust: THRUST,
    },
    "vessel.control": { gear: f.aglMeters < 1500, brakes: false },
    "dv.summary": { totalDvActual: 900, totalDvVac: 950 },
    "comms.delay": { source: 1, oneWaySeconds },
    "vessel.landing": {
      outcome: "terrain-assessed",
      sampleSource: "predicted",
      predictedLatitude: pp.lat,
      predictedLongitude: pp.lon,
      predictedTerrainElevation: 120,
      predictedSlopeAngle: terrain.slope,
      predictedSlopeHeading: terrain.heading,
      predictedRoughness: terrain.roughness,
      roughnessFootprintMeters: 100,
      slopeSampleRadiusMeters: 100,
      predictedBiome: terrain.biome,
      terrainPatch: terrainPatchGrid(terrain.slope, terrain.heading),
      terrainPatchSize: 16,
      terrainPatchExtentMeters: 200,
    },
  };
}

const CARRIED = [
  "system.bodies",
  "vessel.identity",
  "vessel.orbit",
  "vessel.flight",
  "vessel.surface",
  "vessel.propulsion",
  "vessel.control",
  "dv.summary",
  "comms.delay",
  "vessel.landing",
];

function streamFixture(
  f: Frame,
  oneWaySeconds: number,
  scenario: string,
  notes: string,
): Record<string, unknown> {
  const ch = channelsFor(f, oneWaySeconds);
  const emits = CARRIED.map((channel) => {
    const value = ch[channel];
    // vessel.orbit must carry quality:1 (Loaded) so vessel.state derives in the
    // measured basis (real altitude off vessel.flight) — mirrors the tests.
    return channel === "vessel.orbit"
      ? { channel, value, meta: { quality: 1 } }
      : { channel, value };
  });
  return {
    _meta: {
      scenario,
      synthetic: true,
      notes: `SYNTHETIC (model-generated, NOT captured). ${notes}`,
    },
    _stream: { carriedChannels: CARRIED, pinnedUt: 10, emits },
  };
}

// ── Emit ──────────────────────────────────────────────────────────────────────
const frames = integrate();

const ndjsonDir = resolve(
  import.meta.dirname,
  "../../../local_docs/deck-fixtures",
);
mkdirSync(ndjsonDir, { recursive: true });
const ndjson = frames
  .map((f) => {
    const g = MU / (R + f.aglMeters) ** 2;
    return JSON.stringify({
      _synthetic: true,
      t: f.t,
      channels: channelsFor(f, 4),
      burning: f.burning,
      localGravity: g,
    });
  })
  .join("\n");
writeFileSync(
  resolve(ndjsonDir, "synthetic-descent-mun.ndjson"),
  `${ndjson}\n`,
);

// Pick four telling frames sweeping the hazard verdict DIVERT -> MARGINAL ->
// SAFE plus the burn states: high (freefall, DIVERT site far downrange),
// ignition (first burning frame — hot band lit, still fast so DIVERT), approach
// (slow final-approach over a MARGINAL slope), and final (SAFE soft touchdown).
const high = frames.find((f) => !f.burning && f.aglMeters <= 7500) ?? frames[0];
const ignition =
  frames.find((f) => f.burning) ?? frames[Math.floor(frames.length / 2)];
const approach =
  frames.find((f) => f.burning && f.aglMeters <= 150) ??
  frames[frames.length - 2];
const final =
  frames.find((f) => f.aglMeters <= 40) ?? frames[frames.length - 1];

const fixDir = resolve(import.meta.dirname, "../src/LandingStatus/__render__");
mkdirSync(fixDir, { recursive: true });
writeFileSync(
  resolve(fixDir, "descent-high.json"),
  `${JSON.stringify(streamFixture(high, 1.4, "descent-high", "High descent: reticle far downrange, steep+rough site -> DIVERT; STAGED delay."), null, 2)}\n`,
);
writeFileSync(
  resolve(fixDir, "descent-ignition.json"),
  `${JSON.stringify(streamFixture(ignition, 4, "descent-ignition", "Suicide-burn ignition: committed, still fast so the site reads DIVERT; AUTONOMOUS delay."), null, 2)}\n`,
);
writeFileSync(
  resolve(fixDir, "descent-approach.json"),
  `${JSON.stringify(streamFixture(approach, 4, "descent-approach", "Final approach: slowed to a soft descent over a MARGINAL slope; commit clocks live."), null, 2)}\n`,
);
writeFileSync(
  resolve(fixDir, "descent-final.json"),
  `${JSON.stringify(streamFixture(final, 4, "descent-final", "Final: near touchdown, smooth flat site -> SAFE, gear down."), null, 2)}\n`,
);

console.log(`frames: ${frames.length}`);
console.log(
  `high: agl=${Math.round(high.aglMeters)} ignition: agl=${Math.round(ignition.aglMeters)} burning=${ignition.burning} final: agl=${Math.round(final.aglMeters)}`,
);
console.log(`ndjson -> ${resolve(ndjsonDir, "synthetic-descent-mun.ndjson")}`);
console.log(`fixtures -> ${fixDir}`);
