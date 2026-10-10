import {
  ballisticDrift,
  channelsFor,
  coneFootprint,
  DEFAULT_RELIEF,
  DEG,
  type Frame,
  fixtureFromChannels,
  groundTrackDistances,
  groundTrackElevations,
  type Relief,
  SITE_GRID_SIZE,
  siteGridHalfExtent,
  siteGridHeights,
  trackExtent,
} from "./landingDescentModel";

/**
 * A capsule coming down through Kerbin's air onto land or the ocean: the stories for the atmospheric board, which the Mun descent cannot show.
 * Drag is the only thing slowing it: ballistic until a parachute opens, then a slow settle under canopy.
 */

/** The body a descent falls through: its size and gravity, its air, and how fast the capsule falls in that air. */
export interface AtmosphereBody {
  /** As the stream names it, and the registry knows it. */
  name: string;
  index: number;
  radius: number;
  mu: number;
  /** Air at sea level, kg per cubic metre, and the height over which it thins by a factor of e, metres. */
  seaLevelDensity: number;
  scaleHeight: number;
  /** The speeds the capsule falls at in sea-level air, ballistic and under an open canopy, m/s. */
  ballisticTerminal: number;
  canopyTerminal: number;
  /** How high the air reaches, metres. */
  atmosphereDepth: number;
}

export const KERBIN_AIR: AtmosphereBody = {
  name: "Kerbin",
  index: 1,
  radius: 600_000,
  mu: 3.5316e12,
  seaLevelDensity: 1.225,
  scaleHeight: 5600,
  ballisticTerminal: 115,
  canopyTerminal: 5.5,
  atmosphereDepth: 70_000,
};

/** Eve: five atmospheres at sea level and two thirds again Kerbin's gravity. Its terminal speeds are Kerbin's scaled by the square root of gravity over density, the capsule and canopy the same. */
export const EVE_AIR: AtmosphereBody = {
  name: "Eve",
  index: 5,
  radius: 700_000,
  mu: 8.1717302e12,
  seaLevelDensity: 4.2,
  scaleHeight: 7000,
  ballisticTerminal: 81,
  canopyTerminal: 3.9,
  atmosphereDepth: 90_000,
};

/** Height above the surface below which the air is thick enough for the armed chute to open as a streamer, metres: stock opens it on the air's pressure, which over Kerbin is about here. */
const CHUTE_ALTITUDE_M = 2400;
/** Height above the surface at which it opens fully, metres: stock's default deploy altitude. */
export const FULL_DEPLOY_AGL_M = 1000;
/** How much of the canopy's drag the streamer gives, and the seconds it takes to open. */
const SEMI_SHARE = 0.1;
const SEMI_OPENING_S = 2;
/** Seconds the canopy takes to open fully. */
const CHUTE_OPENING_S = 8;
const SUBSTEP_S = 0.02;

/** What a descent lands on. */
export interface AtmosphereWorld {
  /** True when the surface it meets is the sea, whose floor the ground strip reads and the capsule never reaches. */
  ocean: boolean;
  /** The body it falls through; Kerbin when omitted. */
  body?: AtmosphereBody;
}

function bodyOf(world: AtmosphereWorld): AtmosphereBody {
  return world.body ?? KERBIN_AIR;
}

/** Where the descent begins: the height above the surface and the speeds down and along it. */
export interface AtmosphereStart {
  agl: number;
  vDown: number;
  vHoriz: number;
}

/** Entering from 25 km on a flat arc. */
export const ENTRY_DESCENT: AtmosphereStart = {
  agl: 25_000,
  vDown: 350,
  vHoriz: 450,
};

/** Already low and slow enough to open the canopy soon: the last stretch over the sea. */
export const LOW_DESCENT: AtmosphereStart = {
  agl: 7_000,
  vDown: 60,
  vHoriz: 40,
};

export interface AtmosphereFrame extends Frame {
  /** Height above sea level, metres. */
  asl: number;
  /** Air density, kg per cubic metre. */
  density: number;
  /** Speed against the speed of sound. */
  mach: number;
  /** The speed the capsule would settle to at this height as it is now, m/s. */
  terminal: number;
  /** How open the canopy is, 0 stowed to 1 open. */
  canopy: number;
  /** How far the chute has opened, in the mod's words: armed until it streams, semi-deployed as a streamer, deployed once it opens fully. */
  chute: "armed" | "semi-deployed" | "deployed";
}

/** How open the canopy is after a streamer this many seconds open and a full opening this many: negative for one not begun. */
function canopyOf(semiFor: number, fullFor: number): number {
  const semi = semiFor < 0 ? 0 : Math.min(1, semiFor / SEMI_OPENING_S);
  const full = fullFor < 0 ? 0 : Math.min(1, fullFor / CHUTE_OPENING_S);
  return SEMI_SHARE * semi + (1 - SEMI_SHARE) * full;
}

/** Rolling country: a third of the Mun's relief, which keeps the whole site above the sea. */
const LAND_RELIEF: Relief = (east, north, cell) =>
  0.3 * DEFAULT_RELIEF(east, north, cell);

/** The elevation of the land at the site, metres above sea level; the ocean's floor is below the sea. */
const LAND_ELEVATION_M = 250;
const OCEAN_FLOOR_M = -140;

function surfaceElevation(world: AtmosphereWorld): number {
  return world.ocean ? OCEAN_FLOOR_M : LAND_ELEVATION_M;
}

/** The height above sea level of the surface the capsule meets: the sea's top or the land. */
function surfaceAsl(world: AtmosphereWorld): number {
  return world.ocean ? 0 : LAND_ELEVATION_M;
}

function density(asl: number, body: AtmosphereBody): number {
  return body.seaLevelDensity * Math.exp(-Math.max(0, asl) / body.scaleHeight);
}

/** The terminal speed at a height, from the speed in sea-level air and the density there. */
function terminalAt(
  asl: number,
  seaLevelTerminal: number,
  body: AtmosphereBody,
): number {
  return (
    seaLevelTerminal * Math.sqrt(body.seaLevelDensity / density(asl, body))
  );
}

/**
 * Integrate the descent at 1 Hz from fine steps: drag opposes the velocity with a strength set by the terminal speed at the height, the canopy opens over a few seconds below its release height, and the descent ends on the surface.
 */
export function integrateAtmosphere(
  world: AtmosphereWorld,
  start: AtmosphereStart = ENTRY_DESCENT,
): AtmosphereFrame[] {
  const base = surfaceAsl(world);
  const body = bodyOf(world);
  let agl = start.agl;
  let vDown = start.vDown;
  let vHoriz = start.vHoriz;
  let lon = -74.6;
  let semiFor = -1;
  let fullFor = -1;
  const frames: AtmosphereFrame[] = [];
  const frame = (t: number, landed = false): AtmosphereFrame => {
    const asl = base + agl;
    const canopy = canopyOf(semiFor, fullFor);
    const seaLevelTerminal =
      body.ballisticTerminal +
      (body.canopyTerminal - body.ballisticTerminal) * canopy;
    const speed = Math.hypot(vDown, vHoriz);
    return {
      t,
      aglMeters: agl,
      vDown,
      vHoriz,
      lat: -0.05,
      lon,
      burning: false,
      landed,
      asl,
      density: density(asl, body),
      mach: speed / (asl > 12_000 ? 295 : 340),
      terminal: terminalAt(asl, seaLevelTerminal, body),
      canopy,
      chute:
        fullFor >= 0 ? "deployed" : semiFor >= 0 ? "semi-deployed" : "armed",
    };
  };
  for (let t = 0; t < 900 && agl > 0; t++) {
    frames.push(frame(t));
    for (let s = 0; s < 1 / SUBSTEP_S && agl > 0; s++) {
      const asl = base + agl;
      if (
        semiFor < 0 &&
        agl < CHUTE_ALTITUDE_M &&
        Math.hypot(vDown, vHoriz) < 260
      ) {
        semiFor = 0;
      }
      if (semiFor >= 0 && fullFor < 0 && agl < FULL_DEPLOY_AGL_M) fullFor = 0;
      if (semiFor >= 0) semiFor += SUBSTEP_S;
      if (fullFor >= 0) fullFor += SUBSTEP_S;
      const canopy = canopyOf(semiFor, fullFor);
      const vt = terminalAt(
        asl,
        body.ballisticTerminal +
          (body.canopyTerminal - body.ballisticTerminal) * canopy,
        body,
      );
      const g = body.mu / (body.radius + asl) ** 2;
      const speed = Math.hypot(vDown, vHoriz);
      const drag = g * (speed / vt) ** 2;
      // Drag opposes the velocity; gravity pulls down.
      const ax = speed > 0 ? (-drag * vHoriz) / speed : 0;
      const ay = speed > 0 ? (-drag * vDown) / speed : 0;
      vHoriz = Math.max(0, vHoriz + ax * SUBSTEP_S);
      vDown = vDown + (g + ay) * SUBSTEP_S;
      lon += (vHoriz * SUBSTEP_S) / (body.radius * Math.cos(-0.05 * DEG)) / DEG;
      agl -= vDown * SUBSTEP_S;
    }
  }
  agl = 0;
  const last = frames[frames.length - 1];
  const settled = frame((last?.t ?? 0) + 1, true);
  frames.push({ ...settled, vDown: 0, vHoriz: 0, terminal: settled.terminal });
  return frames;
}

/** Speeds above which opening the chute is risky and then unsafe, m/s: a stand-in for the game's own check, which rates the heating the speed would bring a canopy. */
const RISKY_DEPLOY_MPS = 300;
const UNSAFE_DEPLOY_MPS = 450;

function deploySafety(speed: number): "safe" | "risky" | "unsafe" {
  if (speed > UNSAFE_DEPLOY_MPS) return "unsafe";
  return speed > RISKY_DEPLOY_MPS ? "risky" : "safe";
}

/** The regime the drag puts the descent in, by how its drag compares with its weight. */
function regimeOf(f: AtmosphereFrame): { regime: string; ratio: number } {
  const speed = Math.hypot(f.vDown, f.vHoriz);
  const ratio = (speed / f.terminal) ** 2;
  const regime =
    f.mach > 5
      ? "hypersonic"
      : ratio > 1.15
        ? "decelerating"
        : ratio < 0.85
          ? "accelerating"
          : "at-terminal";
  return { regime, ratio };
}

/**
 * The stream a frame of the descent sends: the Mun descent's channels with the body, the flight, the surface and the landing fields replaced by the atmosphere's own, and the ground the site's land or the ocean's floor.
 */
export function atmosphereChannelsFor(
  f: AtmosphereFrame,
  world: AtmosphereWorld,
  channels: Record<string, unknown>,
): Record<string, unknown> {
  const elevation = surfaceElevation(world);
  const body = bodyOf(world);
  const speed = Math.hypot(f.vDown, f.vHoriz);
  // What the mod predicts: the drag-free conic walked to the surface, which the drag pulls back toward the craft as it slows.
  const drift = ballisticDrift(
    f.aglMeters,
    f.vDown,
    f.vHoriz,
    body.mu / (body.radius + f.asl) ** 2,
  );
  const pp = {
    lat: f.lat,
    lon: f.lon + drift / (body.radius * Math.cos(f.lat * DEG)) / DEG,
  };
  const footprint = coneFootprint(f.aglMeters, f.vDown, f.vHoriz, body.radius);
  const extent = trackExtent(
    footprint.behind,
    footprint.ahead,
    f.aglMeters,
    drift,
  );
  const distances = groundTrackDistances(extent.behind, extent.ahead);
  const halfExtent = siteGridHalfExtent(drift, f.aglMeters);
  const canopyOpen = f.canopy > 0;
  const { regime, ratio } = regimeOf(f);
  const touchdown = terminalAt(surfaceAsl(world), body.canopyTerminal, body);
  const identity = channels["vessel.identity"];
  return {
    ...channels,
    "system.bodies": {
      bodies: [
        {
          name: body.name,
          index: body.index,
          parentIndex: 0,
          radius: body.radius,
          gravParameter: body.mu,
          atmosphere: {
            depth: body.atmosphereDepth,
            hasOxygen: body === KERBIN_AIR,
          },
          hasOcean: true,
          orbit: null,
        },
      ],
    },
    "vessel.identity": {
      ...(typeof identity === "object" && identity !== null ? identity : {}),
      name: "Reentry Capsule",
      parentBodyIndex: body.index,
      situation: f.landed ? (world.ocean ? 1 : 0) : 6,
    },
    "vessel.orbit": {
      referenceBodyIndex: body.index,
      sma: 610_000,
      ecc: 0.005,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 10,
      mu: body.mu,
      horizon: { kind: 1, trajectoryKind: 1 },
    },
    "vessel.flight": {
      latitude: f.lat,
      longitude: f.lon,
      altitudeAsl: f.asl,
      // Over the sea the height above the surface is the height above the water, whatever the floor below it.
      altitudeTerrain: f.aglMeters,
      verticalSpeed: -f.vDown,
      surfaceSpeed: speed,
      orbitalSpeed: speed,
      atmDensity: f.density,
      atmosphericTemperature: 288 - Math.min(f.asl, 11_000) * 0.0065,
      externalTemperature: 288 + Math.max(0, f.mach - 1) * 400,
      mach: f.mach,
    },
    "vessel.surface": {
      biome: world.ocean ? "Water" : "Grasslands",
      landedAt: f.landed ? String(10 + f.t) : null,
      heightFromTerrain: f.aglMeters,
    },
    "vessel.propulsion": {
      // A capsule: it has no engine to burn.
      totalMass: 5,
      dryMass: 3,
      currentThrust: 0,
      availableThrust: 0,
    },
    "vessel.landing": {
      outcome: "atmosphere-modelled",
      sampleSource: "predicted",
      predictedLatitude: pp.lat,
      predictedLongitude: pp.lon,
      predictedTerrainElevation: elevation,
      predictedSlopeAngle: world.ocean ? 0 : 4.5,
      predictedSlopeHeading: 120,
      predictedRoughness: world.ocean ? 0 : 40,
      roughnessFootprintMeters: 60,
      slopeSampleRadiusMeters: 100,
      predictedBiome: world.ocean ? "Water" : "Grasslands",
      terminalVelocity: f.terminal,
      projectedTouchdownSpeed: touchdown,
      atmosphericTimeToImpact: Math.max(
        0,
        f.aglMeters / Math.max(f.terminal, 1),
      ),
      descentRegime: regime,
      parachuteState: canopyOpen ? "deployed" : "armed",
      parachuteDeployment: f.landed ? "cut" : f.chute,
      parachuteDeploySafety:
        !f.landed && f.chute === "armed" ? deploySafety(speed) : null,
      parachuteFullDeployAltitude:
        !f.landed && f.chute !== "deployed" ? FULL_DEPLOY_AGL_M : null,
      dragToWeightRatio: ratio,
      groundTrackDistances: distances,
      groundTrackElevations: groundTrackElevations(
        distances,
        drift,
        elevation,
        world.ocean ? () => 0 : LAND_RELIEF,
      ),
      siteHeights: siteGridHeights(
        halfExtent,
        elevation,
        world.ocean ? () => 0 : LAND_RELIEF,
      ),
      siteHeightsSize: SITE_GRID_SIZE,
      siteHeightsExtentMeters: 2 * halfExtent,
    },
  };
}

/** The stream of a frame of the descent, as a scene a story or a render can mount. */
export function atmosphereStream(
  f: AtmosphereFrame,
  oneWaySeconds: number,
  world: AtmosphereWorld,
  scenario: string,
  notes: string,
): Record<string, unknown> {
  return fixtureFromChannels(
    atmosphereChannelsFor(f, world, channelsFor(f, oneWaySeconds)),
    scenario,
    notes,
  );
}
