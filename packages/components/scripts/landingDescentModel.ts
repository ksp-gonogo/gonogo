/**
 * The synthetic Mun descent the Landing Status renders and stories are fed: the
 * integrated trajectory and the Topic payloads each frame puts on the stream.
 * Free of Node APIs, so a story can run it in the browser.
 */
import { solveSuicideBurn } from "../src/LandingStatus/solveLanding";

// ── Mun ──────────────────────────────────────────────────────────────────────
export const MU = 6.5138398e10;
export const R = 200_000;
export const MASS = 5; // tonnes
export const THRUST = 18; // kN -> aMax = 3.6 m/s^2, TWR ~= 2.2 at the surface
export const START_LAT = 0.0;
export const START_LON = 0.0;
export const DEG = Math.PI / 180;

export interface Frame {
  t: number;
  aglMeters: number;
  vDown: number;
  vHoriz: number;
  lat: number;
  lon: number;
  burning: boolean;
  /** True on the final touched-down frame (situation → Landed, all motion 0). */
  landed?: boolean;
}

/** Where a crashing descent lights its engine: far too low to shed the speed it has built up. */
const CRASH_IGNITION_AGL = 700;

/**
 * Integrate a deorbit descent at 1 Hz. By default it ends on a settled touchdown
 * after a suicide burn; with `crash` it lights the engine too late, which at this
 * thrust cannot cancel the speed, and ends on the frame that meets the ground.
 */
export function integrate(opts: { crash?: boolean } = {}): Frame[] {
  if (opts.crash) return integrateCrash();
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
    // Burn once the full-vector burn no longer fits the remaining altitude,
    // solveSuicideBurn signals that with a zero countdown ("ignite now").
    // Latch it: a real suicide burn stays committed through touchdown rather
    // than un-committing into freefall the instant the solve says it fits again.
    if (solution.suicideBurnCountdown === 0) committed = true;
    const burning = committed;

    frames.push({ t, aglMeters: agl, vDown, vHoriz, lat, lon, burning });

    const aMax = THRUST / MASS;
    if (burning) {
      // Guided suicide burn. Bleed horizontal velocity off GRADUALLY, tied to
      // altitude (vHoriz ≤ agl·k), so the ground track converges on the site
      // smoothly across the WHOLE descent instead of nulling lateral in the
      // first few seconds and then sitting dead over the site. This is what
      // makes the predicted-point drift shrink visibly frame-to-frame (the
      // top-down current marker tracks in toward the centred site). Hold the
      // descent rate on a constant-net-deceleration profile that reaches ~0 at
      // the ground, easing to a gentle final approach so touchdown is soft.
      vHoriz = Math.min(vHoriz, agl * 0.02);
      let targetVDown = Math.sqrt(
        2 * Math.max(0.1, aMax - g) * Math.max(agl, 0),
      );
      if (agl < 400) targetVDown = Math.min(targetVDown, 1.0 + agl / 100);
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
  // Touchdown: a final settled frame on the surface (all motion nulled). This is
  // what makes the widget read LANDED at the end of the descent rather than a
  // stale "Blind in Xs" future countdown.
  const last = frames[frames.length - 1];
  frames.push({
    t: (last?.t ?? 0) + 1,
    aglMeters: 0,
    vDown: 0,
    vHoriz: 0,
    lat,
    lon,
    burning: false,
    landed: true,
  });
  return frames;
}

function integrateCrash(): Frame[] {
  const frames: Frame[] = [];
  let agl = 8000;
  let vDown = 25;
  let vHoriz = 160;
  let lon = START_LON;
  const aMax = THRUST / MASS;
  for (let t = 0; t < 300; t++) {
    const burning = agl < CRASH_IGNITION_AGL;
    frames.push({
      t,
      aglMeters: agl,
      vDown,
      vHoriz,
      lat: START_LAT,
      lon,
      burning,
    });
    const g = MU / (R + agl) ** 2;
    vDown = Math.max(0, vDown + (burning ? g - aMax : g));
    if (burning) vHoriz = Math.max(0, vHoriz - aMax / 2);
    lon += vHoriz / (R * Math.cos(START_LAT * DEG)) / DEG;
    agl -= vDown;
    if (agl <= 0) {
      frames.push({
        t: t + 1,
        aglMeters: 0,
        vDown,
        vHoriz,
        lat: START_LAT,
        lon,
        burning,
      });
      return frames;
    }
  }
  return frames;
}

// ── Terrain sweep: rough/steep high, smooth/flat low ──────────────────────────
export function terrainFor(aglMeters: number): {
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
export function terrainPatchGrid(
  slopeDeg: number,
  headingDeg: number,
): number[] {
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

/** The predicted touchdown point: current point + remaining downrange travel.
 * Exported for the convergence guard test (predicted → actual touchdown as
 * agl → 0). */
export function predictedPoint(f: Frame): { lat: number; lon: number } {
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

/**
 * The craft's `vessel.orbit` elements at the pinned instant, from the same state its flight figures give: `vDown` straight down and `vHoriz` eastward, `agl` above the equator at `lon`, in the body's non-rotating frame.
 * A frame with no motion is a rectilinear fall; its eccentricity is held just under 1 so the conic stays an ellipse.
 */
export function orbitFor(f: Frame, epoch: number): Record<string, unknown> {
  const r = R + f.aglMeters;
  const theta = f.lon * DEG;
  const vr = -f.vDown;
  const vt = f.vHoriz;
  const speedSq = vr * vr + vt * vt;
  const energy = speedSq / 2 - MU / r;
  const h = r * vt;
  const ecc = Math.min(0.9999, Math.sqrt(1 + (2 * energy * h * h) / (MU * MU)));
  // Eccentricity vector in the orbital plane: ((v^2 - mu/r) r - (r.v) v) / mu, with r along theta and v = vr r^ + vt e^.
  const k = speedSq - MU / r;
  const ex =
    (k * r * Math.cos(theta) -
      r * vr * (vr * Math.cos(theta) - vt * Math.sin(theta))) /
    MU;
  const ey =
    (k * r * Math.sin(theta) -
      r * vr * (vr * Math.sin(theta) + vt * Math.cos(theta))) /
    MU;
  const argPe = Math.atan2(ey, ex);
  const nu = theta - argPe;
  const E =
    2 *
    Math.atan2(
      Math.sqrt(1 - ecc) * Math.sin(nu / 2),
      Math.sqrt(1 + ecc) * Math.cos(nu / 2),
    );
  const meanAnomaly = E - ecc * Math.sin(E);
  return {
    referenceBodyIndex: 3,
    sma: -MU / (2 * energy),
    ecc,
    inc: 0,
    lan: 0,
    argPe: argPe / DEG,
    meanAnomalyAtEpoch: meanAnomaly,
    epoch,
    mu: MU,
  };
}

export function channelsFor(
  f: Frame,
  oneWaySeconds: number,
): Record<string, unknown> {
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
      // Situation ordinals (VesselEnums.cs): 0 = Landed, 6 = SubOrbital. The
      // descent reads SubOrbital; only the final touched-down frame is Landed.
      situation: f.landed ? 0 : 6,
      parentBodyIndex: 3,
      launchUt: null,
    },
    "vessel.orbit": orbitFor(f, 10),
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
      landedAt: f.landed ? String(10 + f.t) : null,
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

export const EMITTED = [
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

export function fixtureFromChannels(
  ch: Record<string, unknown>,
  scenario: string,
  notes: string,
): Record<string, unknown> {
  const emits = EMITTED.map((channel) => {
    const value = ch[channel];
    // A descending craft is under physics, so its vessel.orbit sample carries quality:1 (Loaded), as the mod stamps it.
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
    _stream: { pinnedUt: 10, emits },
  };
}

export function streamFixture(
  f: Frame,
  oneWaySeconds: number,
  scenario: string,
  notes: string,
): Record<string, unknown> {
  return fixtureFromChannels(channelsFor(f, oneWaySeconds), scenario, notes);
}
