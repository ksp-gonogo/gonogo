/**
 * The synthetic Mun descent the Landing Status renders and stories are fed: the
 * integrated trajectory and the Topic payloads each frame puts on the stream.
 * Free of Node APIs, so a story can run it in the browser.
 */
import { solveSuicideBurn } from "../src/LandingStatus/solveLanding";
import { SHOWS } from "./landingFixtureProse";

// ── Mun ──────────────────────────────────────────────────────────────────────
export const MU = 6.5138398e10;
export const R = 200_000;
export const MASS = 5; // tonnes
export const THRUST = 18; // kN -> aMax = 3.6 m/s^2, TWR ~= 2.2 at the surface
export const START_LAT = 0.0;
export const START_LON = 0.0;
export const DEG = Math.PI / 180;

/** Where a descent begins: height above the ground, and the speeds down and along it. */
export interface DescentStart {
  agl: number;
  vDown: number;
  vHoriz: number;
}

/** The default descent: from 8 km at about nine degrees below level. */
const DEEP_DESCENT: DescentStart = { agl: 8000, vDown: 25, vHoriz: 160 };

/** A shallow approach: 4 km up, under five degrees below level and slow enough for the engine to stop it, so most of the descent is spent travelling sideways. */
export const SHALLOW_DESCENT: DescentStart = {
  agl: 4000,
  vDown: 8,
  vHoriz: 100,
};

export interface Frame {
  t: number;
  aglMeters: number;
  vDown: number;
  vHoriz: number;
  lat: number;
  lon: number;
  burning: boolean;
  /** While burning, the thrust's acceleration straight up and along the way of travel, m/s squared; the engines' own push, whatever the speeds do. */
  thrustUp?: number;
  thrustAlong?: number;
  /** True on the final touched-down frame (situation → Landed, all motion 0). */
  landed?: boolean;
}

/** The longest a descent is integrated, seconds: long enough for a soft approach to reach the ground. */
const MAX_DESCENT_SECONDS = 900;

/** The descent rate the profile settles to at the ground, m/s: under the half metre a second above which the widget calls a landing one no burn can make. */
const TOUCHDOWN_SPEED = 0.3;

/** The speed under which the craft has shed what it came with and eases down, m/s. */
const SETTLE_SPEED = 4;

/** How early the burn is lit before the solve says ignite, seconds. */
const IGNITION_MARGIN_SECONDS = 3;

/** How high the landing site stands above the body's datum, metres. */
const SITE_ELEVATION_M = 120;

/** Where a crashing descent lights its engine: far too low to shed the speed it has built up. */
const CRASH_IGNITION_AGL = 700;

/**
 * Integrate a deorbit descent at 1 Hz. By default it ends on a settled touchdown
 * after a suicide burn; with `crash` it lights the engine too late, which at this
 * thrust cannot cancel the speed, and ends on the frame that meets the ground.
 */
/** Seconds per step of the fine integration inside each second of the descent. */
const SUBSTEP_S = 0.1;
/** How much more deceleration than the stop needs the burn commands: the margin a pilot keeps. */
const BURN_MARGIN = 1.2;

/**
 * The push the engine gives this instant in a descent to a soft touchdown, as acceleration up and along the way of travel (negative along: against it).
 * Until the speed is nearly shed the thrust is held retrograde, against the velocity, at the throttle that stops the craft at the ground with a margin; a real landing burn is flown that way, and its exhaust points along the velocity. Once the speed is a few metres a second it eases down the last stretch on a vertical push.
 */
function retroBurn(i: {
  agl: number;
  vDown: number;
  vHoriz: number;
  g: number;
  aMax: number;
  settled: boolean;
  dt: number;
}): { up: number; along: number; settled: boolean } {
  const speed = Math.hypot(i.vDown, i.vHoriz);
  const settled = i.settled || speed < SETTLE_SPEED;
  if (settled) {
    const target = TOUCHDOWN_SPEED + i.agl / 50;
    const up = Math.min(i.aMax, Math.max(0, i.g + (i.vDown - target) / i.dt));
    return {
      up,
      along: i.vHoriz > 0 ? -Math.min(0.5, i.vHoriz / i.dt) : 0,
      settled,
    };
  }
  // The share of the speed that is downward is how steeply the path falls: the ground is that much farther along it.
  const steep = i.vDown / speed;
  const path = i.agl / Math.max(steep, 0.15);
  const stop =
    Math.max(speed * speed - TOUCHDOWN_SPEED * TOUCHDOWN_SPEED, 0) /
      (2 * path) +
    i.g * steep;
  const a = Math.min(i.aMax, stop * BURN_MARGIN);
  return { up: (a * i.vDown) / speed, along: (-a * i.vHoriz) / speed, settled };
}

export function integrate(
  opts: { crash?: boolean; start?: DescentStart } = {},
): Frame[] {
  if (opts.crash) return integrateCrash();
  const start = opts.start ?? DEEP_DESCENT;
  let agl = start.agl; // m above terrain
  let vDown = start.vDown; // m/s, descending
  let vHoriz = start.vHoriz; // m/s, mostly-horizontal orbital leftover
  const lat = START_LAT;
  let lon = START_LON;
  let committed = false; // once the suicide burn starts it stays on (no un-commit)
  let settled = false; // the speed is shed and the craft is easing down the last stretch
  const frames: Frame[] = [];

  for (let t = 0; t < MAX_DESCENT_SECONDS && agl > 0; t++) {
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
    // Lit a few seconds early, as a pilot would: the countdown is read once a second, and a frame past zero is already a burn that is too late.
    if (
      solution.suicideBurnCountdown !== null &&
      solution.suicideBurnCountdown <= IGNITION_MARGIN_SECONDS
    ) {
      committed = true;
    }
    const burning = committed;

    const aMax = THRUST / MASS;
    // The engine's push this instant: along the retrograde direction while the descent has speed to shed, so its exhaust points along the velocity.
    const push = burning
      ? retroBurn({ agl, vDown, vHoriz, g, aMax, settled, dt: SUBSTEP_S })
      : null;
    if (push?.settled) settled = true;

    frames.push({
      t,
      aglMeters: agl,
      vDown,
      vHoriz,
      lat,
      lon,
      burning,
      ...(push ? { thrustUp: push.up, thrustAlong: push.along } : {}),
    });

    // One second in fine steps: the push is recomputed each step, so the path bends as the speed falls.
    for (let s = 0; s < 1 / SUBSTEP_S && agl > 0; s++) {
      const gNow = MU / (R + agl) ** 2;
      const now = burning
        ? retroBurn({
            agl,
            vDown,
            vHoriz,
            g: gNow,
            aMax,
            settled,
            dt: SUBSTEP_S,
          })
        : null;
      if (now?.settled) settled = true;
      vDown = vDown + (gNow - (now?.up ?? 0)) * SUBSTEP_S;
      vHoriz = Math.max(0, vHoriz + (now?.along ?? 0) * SUBSTEP_S);
      lon += (vHoriz * SUBSTEP_S) / (R * Math.cos(lat * DEG)) / DEG;
      agl -= vDown * SUBSTEP_S;
    }
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
    const speed = Math.hypot(vDown, vHoriz);
    // Lit too late to stop, the engine still pushes straight against the velocity.
    const up = burning && speed > 0 ? (aMax * vDown) / speed : 0;
    const along = burning && speed > 0 ? (-aMax * vHoriz) / speed : 0;
    frames.push({
      t,
      aglMeters: agl,
      vDown,
      vHoriz,
      lat: START_LAT,
      lon,
      burning,
      ...(burning ? { thrustUp: up, thrustAlong: along } : {}),
    });
    const g = MU / (R + agl) ** 2;
    vDown = Math.max(0, vDown + g - up);
    vHoriz = Math.max(0, vHoriz + along);
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
        ...(burning ? { thrustUp: up, thrustAlong: along } : {}),
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

/** Terrain reads per ground-track strip; the same figure the mod's `LandingGroundTrack.SampleCount` fixes. */
export const GROUND_TRACK_SAMPLES = 48;

/** Great-circle distance in metres between two lat/lon points (degrees) on a sphere of the given radius. */
export function greatCircleMeters(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  radius: number,
): number {
  const p1 = fromLat * DEG;
  const p2 = toLat * DEG;
  const a =
    Math.sin((p2 - p1) / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(((toLon - fromLon) * DEG) / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The half angle of the cone the vessel sees the ground through; the mod's `LandingCone.HalfAngleDegrees`. */
const CONE_HALF_ANGLE_DEG = 60;
/** The farthest a footprint reaches in any case, metres; the mod's `LandingCone.AbsoluteMaxRangeMeters`. */
const CONE_ABSOLUTE_MAX_RANGE_M = 100_000;

/** Where a cone about the travel vector meets the ground, metres along the ground from beneath the vessel, positive ahead. */
export interface ConeFootprint {
  behind: number;
  ahead: number;
}

/**
 * The footprint of a 60 degree half-angle cone about the vessel's travel vector: where its two edges, in the plane of motion, meet flat ground, with a ray that never does cut at the horizon.
 * Mirrors `LandingCone.FootprintOf`.
 */
export function coneFootprint(
  heightMeters: number,
  descentRate: number,
  horizontalSpeed: number,
  bodyRadius: number,
): ConeFootprint {
  const height = Math.max(0, Number.isFinite(heightMeters) ? heightMeters : 0);
  const down = Number.isFinite(descentRate) ? descentRate : 0;
  const along = Math.max(
    0,
    Number.isFinite(horizontalSpeed) ? horizontalSpeed : 0,
  );
  const axis =
    down === 0 && along === 0 ? 90 : (Math.atan2(down, along) * 180) / Math.PI;
  const horizon =
    bodyRadius > 0
      ? Math.sqrt(2 * bodyRadius * height + height * height)
      : CONE_ABSOLUTE_MAX_RANGE_M;
  const max = Math.min(horizon, CONE_ABSOLUTE_MAX_RANGE_M);
  const reach = (angle: number): number => {
    if (angle <= 0) return max;
    if (angle >= 180) return -max;
    return Math.max(-max, Math.min(max, height / Math.tan(angle * DEG)));
  };
  return {
    behind: reach(axis + CONE_HALF_ANGLE_DEG),
    ahead: reach(axis - CONE_HALF_ANGLE_DEG),
  };
}

/** The least ground the strip holds either side of the point beneath the vessel, metres; the mod's `LandingGroundTrack.MinMarginMeters`. */
const TRACK_MIN_MARGIN_M = 120;
/** How much of the site's distance the strip carries past the site; the mod's `LandingGroundTrack.SiteReachFraction`. */
const TRACK_SITE_REACH = 0.1;

/**
 * The stretch of ground the strip covers: the cone's footprint widened to hold the ground beneath the vessel with a margin of one vessel height behind it, and the site with a tenth of its distance beyond.
 * Mirrors `LandingGroundTrack.Extent`.
 */
export function trackExtent(
  footprintBehind: number,
  footprintAhead: number,
  heightMeters: number,
  siteAheadMeters: number,
): ConeFootprint {
  const height = Math.max(0, Number.isFinite(heightMeters) ? heightMeters : 0);
  const site = Number.isFinite(siteAheadMeters) ? siteAheadMeters : 0;
  const margin = Math.max(height, TRACK_MIN_MARGIN_M);
  const reach = Math.abs(site) * TRACK_SITE_REACH;
  return {
    behind: Math.min(footprintBehind, footprintAhead, -Math.max(margin, reach)),
    ahead: Math.max(
      footprintBehind,
      footprintAhead,
      margin,
      site * (1 + TRACK_SITE_REACH),
    ),
  };
}

/**
 * Where along the track the mod reads terrain: even steps across the cone's footprint, the point beneath the vessel being distance 0, widened to 200 m about its middle if it is shorter.
 * Mirrors `LandingGroundTrack.Distances`.
 */
export function groundTrackDistances(
  behindMeters: number,
  aheadMeters: number,
): number[] {
  let behind = Math.min(behindMeters, aheadMeters);
  let ahead = Math.max(behindMeters, aheadMeters);
  const shortfall = 200 - (ahead - behind);
  if (shortfall > 0) {
    behind -= shortfall / 2;
    ahead += shortfall / 2;
  }
  const extent = ahead - behind;
  return Array.from(
    { length: GROUND_TRACK_SAMPLES },
    (_, i) => behind + (extent * i) / (GROUND_TRACK_SAMPLES - 1),
  );
}

/** Points along each side of the site grid; the mod's `LandingSiteGrid.Size`. */
export const SITE_GRID_SIZE = 24;

/** The half width of the touchdown plot's window at touchdown, as the plot draws it; `MIN_HALF_SPAN_M` and `SPAN_PADDING` in `touchdownReticlePlot.ts`. */
const WINDOW_MIN_HALF_M = 50 * 1.4;
/** How much the window's half width grows per metre of the craft's height; `HALF_SPAN_PER_HEIGHT` in `touchdownReticlePlot.ts`. */
const WINDOW_HALF_PER_HEIGHT = 0.9;
/** The window's room around the craft and the site, as a multiple of half their distance. */
const WINDOW_SITE_PADDING = 1.4;

/**
 * Half the site grid's width: enough to hold the whole window the touchdown plot draws, never less than 60 m. The window is centred between the craft and the site, so it reaches half the distance to the craft plus its own half width from the site.
 * Mirrors `LandingSiteGrid.HalfExtentMeters`.
 */
export function siteGridHalfExtent(
  siteAheadMeters: number,
  heightMeters: number,
): number {
  const site = Math.abs(siteAheadMeters);
  const half = Math.max(
    WINDOW_MIN_HALF_M + Math.max(0, heightMeters) * WINDOW_HALF_PER_HEIGHT,
    (site / 2) * WINDOW_SITE_PADDING,
  );
  return Math.max(60, (site / 2 + half) * 1.1);
}

/** Height of the ground, metres relative to the site, at a point this many metres east and north of it; `cell` is the width of ground the sample stands for, so a relief can leave out detail finer than that. */
export type Relief = (east: number, north: number, cell?: number) => number;

/** One swell of the stock relief: its height and how fast it rises per metre east and north. */
interface Swell {
  amplitude: number;
  perMetreEast: number;
  perMetreNorth: number;
  phase: number;
}

const DEFAULT_SWELLS: readonly Swell[] = [
  // Broad: tens of kilometres across, in several directions so the ground is hills and basins rather than parallel ridges.
  {
    amplitude: 120,
    perMetreEast: 1 / 12_000,
    perMetreNorth: 1 / 9_000,
    phase: 0.5,
  },
  {
    amplitude: 90,
    perMetreEast: -1 / 8_000,
    perMetreNorth: 1 / 11_000,
    phase: 2.1,
  },
  {
    amplitude: 70,
    perMetreEast: 1 / 5_500,
    perMetreNorth: -1 / 7_000,
    phase: 4.0,
  },
  {
    amplitude: 50,
    perMetreEast: 1 / 4_000,
    perMetreNorth: 1 / 3_200,
    phase: 1.3,
  },
  // Middling: a few kilometres.
  {
    amplitude: 40,
    perMetreEast: -1 / 2_300,
    perMetreNorth: 1 / 1_900,
    phase: 5.0,
  },
  {
    amplitude: 60,
    perMetreEast: 1 / 1_800,
    perMetreNorth: 1 / 2_600,
    phase: 0,
  },
  { amplitude: 25, perMetreEast: 1 / 430, perMetreNorth: 1 / 650, phase: 1 },
  // Fine: tens of metres, seen only close to the ground.
  { amplitude: 3, perMetreEast: 1 / 70, perMetreNorth: 1 / 90, phase: 0 },
  { amplitude: 3, perMetreEast: 1 / 70, perMetreNorth: -1 / 90, phase: 0 },
];

/**
 * How much of a swell survives being read over a `cell` of ground: all of one much wider than the cell, none of one only a few cells across.
 * A swell the spacing cannot resolve would otherwise alias into noise, which real terrain read at a coarse spacing does not.
 */
const resolved = (perMetre: number, cell: number): number =>
  Math.exp(-(((perMetre * cell) / 1.2) ** 2));

/**
 * The relief of the stock descent: broad swells with finer ones on them, in both directions.
 * Each swell fades out where the `cell` of ground a sample stands for is too coarse to show it, so the ground is smooth at every spacing.
 */
export const DEFAULT_RELIEF: Relief = (east, north, cell = 0) =>
  DEFAULT_SWELLS.reduce(
    (sum, w) =>
      sum +
      w.amplitude *
        resolved(w.perMetreEast, cell) *
        resolved(w.perMetreNorth, cell) *
        Math.sin(w.perMetreEast * east + w.perMetreNorth * north + w.phase),
    0,
  );

/** Elevations at the strip's distances, the track running east: fixed in the world, so the same ground is read again each frame, and passing through the site's own elevation at the site. */
export function groundTrackElevations(
  distances: readonly number[],
  driftMeters: number,
  siteElevation: number,
  relief: Relief = DEFAULT_RELIEF,
): number[] {
  const spacing = distances.length > 1 ? distances[1] - distances[0] : 0;
  return distances.map(
    (d) =>
      siteElevation +
      relief(d - driftMeters, 0, spacing) -
      relief(0, 0, spacing),
  );
}

/** The site grid's heights, row by row from the northern row, west to east, around the site. */
export function siteGridHeights(
  halfExtentMeters: number,
  siteElevation: number,
  relief: Relief = DEFAULT_RELIEF,
): number[] {
  const cell = (2 * halfExtentMeters) / SITE_GRID_SIZE;
  const heights: number[] = [];
  for (let row = 0; row < SITE_GRID_SIZE; row++) {
    const north = halfExtentMeters - (row + 0.5) * cell;
    for (let col = 0; col < SITE_GRID_SIZE; col++) {
      const east = -halfExtentMeters + (col + 0.5) * cell;
      heights.push(
        siteElevation + relief(east, north, cell) - relief(0, 0, cell),
      );
    }
  }
  return heights;
}

/**
 * How far ahead of the craft the ground is met if the engine is cut now and only gravity acts, metres: what the mod predicts, a walk of the current conic to the surface, whether or not a burn is lit. Under a burn the point therefore walks back toward the craft as the burn sheds the speed, and it never jumps when the engine lights, since the speeds it is read from do not.
 */
export function ballisticDrift(
  aglMeters: number,
  vDown: number,
  vHoriz: number,
  g: number,
): number {
  const fall =
    (-vDown + Math.sqrt(vDown * vDown + 2 * g * Math.max(0, aglMeters))) / g;
  return vHoriz * fall;
}

/** The predicted touchdown point: the current point plus the travel to the ballistic impact. Exported for the convergence guard test (predicted to actual touchdown as agl falls to 0). */
export function predictedPoint(f: Frame): { lat: number; lon: number } {
  const g = MU / (R + f.aglMeters) ** 2;
  const downrange = ballisticDrift(f.aglMeters, f.vDown, f.vHoriz, g);
  const dLon = downrange / (R * Math.cos(f.lat * DEG)) / DEG;
  return { lat: f.lat, lon: f.lon + dLon };
}

/**
 * The craft's `vessel.orbit` elements at the pinned instant, from the same state its flight figures give: `vDown` straight down and `vHoriz` eastward, `agl` above the equator at `lon`, in the body's non-rotating frame.
 * A frame with no motion is a rectilinear fall; its eccentricity is held just under 1 so the conic stays an ellipse.
 */
export function orbitFor(f: Frame, epoch: number): Record<string, unknown> {
  // Measured from the body's centre: the datum plus the site's height plus the height above it.
  const r = R + SITE_ELEVATION_M + f.aglMeters;
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
    horizon: { kind: 1, trajectoryKind: 1 },
  };
}

/**
 * Where the nose points: along the thrust while the engines are lit, and retrograde (against the velocity) while they are not, which is how a lander is flown to a burn. Pitch is degrees above the horizon and heading degrees clockwise from north, with the descent travelling east.
 */
function attitudeFor(f: Frame): Record<string, number> {
  const up = f.thrustUp ?? f.vDown;
  const along = f.thrustAlong ?? -f.vHoriz;
  const pitch = Math.atan2(up, Math.abs(along)) / DEG;
  const heading = along < 0 ? 270 : 90;
  return {
    pitch,
    heading,
    roll: 0,
    pitchRootFrame: pitch,
    headingRootFrame: heading,
    rollRootFrame: 0,
  };
}

export function channelsFor(
  f: Frame,
  oneWaySeconds: number,
): Record<string, unknown> {
  const vSurf = Math.sqrt(f.vDown * f.vDown + f.vHoriz * f.vHoriz);
  const terrain = terrainFor(f.aglMeters);
  const pp = predictedPoint(f);
  const drift = (pp.lon - f.lon) * DEG * R * Math.cos(f.lat * DEG);
  const footprint = coneFootprint(f.aglMeters, f.vDown, f.vHoriz, R);
  const extent = trackExtent(
    footprint.behind,
    footprint.ahead,
    f.aglMeters,
    drift,
  );
  const distances = groundTrackDistances(extent.behind, extent.ahead);
  const halfExtent = siteGridHalfExtent(drift, f.aglMeters);
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
      // The ground here stands 120 m above the datum, so the height above sea level is that more than the height above the ground.
      altitudeAsl: f.aglMeters + SITE_ELEVATION_M,
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
      // The push the engines are giving: the thrust the model spent this second, which is less than full when only a little is needed.
      currentThrust: f.burning
        ? Math.hypot(f.thrustUp ?? THRUST / MASS, f.thrustAlong ?? 0) * MASS
        : 0,
      availableThrust: THRUST,
    },
    "vessel.attitude": attitudeFor(f),
    "vessel.control": { gear: f.aglMeters < 1500, brakes: false },
    "dv.summary": { totalDvActual: 900, totalDvVac: 950 },
    "comms.delay": { source: 1, oneWaySeconds },
    "vessel.landing": {
      outcome: "terrain-assessed",
      sampleSource: "predicted",
      predictedLatitude: pp.lat,
      predictedLongitude: pp.lon,
      predictedTerrainElevation: SITE_ELEVATION_M,
      predictedSlopeAngle: terrain.slope,
      predictedSlopeHeading: terrain.heading,
      predictedRoughness: terrain.roughness,
      roughnessFootprintMeters: 100,
      slopeSampleRadiusMeters: 100,
      predictedBiome: terrain.biome,
      groundTrackDistances: distances,
      groundTrackElevations: groundTrackElevations(
        distances,
        drift,
        SITE_ELEVATION_M,
      ),
      siteHeights: siteGridHeights(halfExtent, SITE_ELEVATION_M),
      siteHeightsSize: SITE_GRID_SIZE,
      siteHeightsExtentMeters: 2 * halfExtent,
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
  "vessel.attitude",
  "vessel.control",
  "dv.summary",
  "comms.delay",
  "vessel.landing",
];

/**
 * Significant digits a generated figure keeps. The maths library differs in the last digit of a double between machines (a Linux runner and a Mac disagree on the same sine), so derived figures are rounded well above that noise and a regeneration is the same file everywhere.
 */
export const SCENE_SIGNIFICANT_DIGITS = 9;

/** `value` with every number in it rounded to {@link SCENE_SIGNIFICANT_DIGITS} significant digits; a structure is copied, never changed. */
export function roundedScene<T>(value: T): T {
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? (Number(value.toPrecision(SCENE_SIGNIFICANT_DIGITS)) as T)
      : value;
  }
  if (Array.isArray(value)) return value.map(roundedScene) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, roundedScene(v)]),
    ) as T;
  }
  return value;
}

/** The `_meta` of a scene: what it shows, when the prose names it, then the scenario and its note. */
export function sceneMeta(
  scenario: string,
  notes: string,
): Record<string, unknown> {
  return {
    ...(SHOWS[scenario] === undefined ? {} : { shows: SHOWS[scenario] }),
    scenario,
    synthetic: true,
    notes,
  };
}

export function fixtureFromChannels(
  ch: Record<string, unknown>,
  scenario: string,
  notes: string,
): Record<string, unknown> {
  const emits = EMITTED.map((channel) => {
    const value = roundedScene(ch[channel]);
    // A descending craft is under physics, so its vessel.orbit sample carries quality:1 (Loaded), as the mod stamps it.
    return channel === "vessel.orbit"
      ? { channel, value, meta: { quality: 1 } }
      : { channel, value };
  });
  return {
    _meta: sceneMeta(
      scenario,
      `SYNTHETIC (model-generated, NOT captured). ${notes}`,
    ),
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
