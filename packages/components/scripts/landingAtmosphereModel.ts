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

const KERBIN_RADIUS = 600_000;
const KERBIN_MU = 3.5316e12;
const SEA_LEVEL_DENSITY = 1.225;
/** Height over which Kerbin's air thins by a factor of e, metres. */
const SCALE_HEIGHT_M = 5600;
/** The speed a ballistic capsule falls at in sea-level air, m/s. */
const BALLISTIC_TERMINAL = 115;
/** The speed it falls at under an open canopy in sea-level air, m/s. */
const CANOPY_TERMINAL = 5.5;
/** Height above the surface at which the canopy is released, metres. */
const CHUTE_ALTITUDE_M = 2400;
/** Seconds the canopy takes to open. */
const CHUTE_OPENING_S = 8;
const SUBSTEP_S = 0.02;

/** What a descent lands on. */
export interface AtmosphereWorld {
  /** True when the surface it meets is the sea, whose floor the ground strip reads and the capsule never reaches. */
  ocean: boolean;
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

function density(asl: number): number {
  return SEA_LEVEL_DENSITY * Math.exp(-Math.max(0, asl) / SCALE_HEIGHT_M);
}

/** The terminal speed at a height, from the speed in sea-level air and the density there. */
function terminalAt(asl: number, seaLevelTerminal: number): number {
  return seaLevelTerminal * Math.sqrt(SEA_LEVEL_DENSITY / density(asl));
}

/**
 * Integrate the descent at 1 Hz from fine steps: drag opposes the velocity with a strength set by the terminal speed at the height, the canopy opens over a few seconds below its release height, and the descent ends on the surface.
 */
export function integrateAtmosphere(
  world: AtmosphereWorld,
  start: AtmosphereStart = ENTRY_DESCENT,
): AtmosphereFrame[] {
  const base = surfaceAsl(world);
  let agl = start.agl;
  let vDown = start.vDown;
  let vHoriz = start.vHoriz;
  let lon = -74.6;
  let canopyOpenFor = -1;
  const frames: AtmosphereFrame[] = [];
  const frame = (t: number, landed = false): AtmosphereFrame => {
    const asl = base + agl;
    const canopy =
      canopyOpenFor < 0 ? 0 : Math.min(1, canopyOpenFor / CHUTE_OPENING_S);
    const seaLevelTerminal =
      BALLISTIC_TERMINAL + (CANOPY_TERMINAL - BALLISTIC_TERMINAL) * canopy;
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
      density: density(asl),
      mach: speed / (asl > 12_000 ? 295 : 340),
      terminal: terminalAt(asl, seaLevelTerminal),
      canopy,
    };
  };
  for (let t = 0; t < 900 && agl > 0; t++) {
    frames.push(frame(t));
    for (let s = 0; s < 1 / SUBSTEP_S && agl > 0; s++) {
      const asl = base + agl;
      if (
        canopyOpenFor < 0 &&
        agl < CHUTE_ALTITUDE_M &&
        Math.hypot(vDown, vHoriz) < 260
      ) {
        canopyOpenFor = 0;
      }
      if (canopyOpenFor >= 0) canopyOpenFor += SUBSTEP_S;
      const canopy =
        canopyOpenFor < 0 ? 0 : Math.min(1, canopyOpenFor / CHUTE_OPENING_S);
      const vt = terminalAt(
        asl,
        BALLISTIC_TERMINAL + (CANOPY_TERMINAL - BALLISTIC_TERMINAL) * canopy,
      );
      const g = KERBIN_MU / (KERBIN_RADIUS + asl) ** 2;
      const speed = Math.hypot(vDown, vHoriz);
      const drag = g * (speed / vt) ** 2;
      // Drag opposes the velocity; gravity pulls down.
      const ax = speed > 0 ? (-drag * vHoriz) / speed : 0;
      const ay = speed > 0 ? (-drag * vDown) / speed : 0;
      vHoriz = Math.max(0, vHoriz + ax * SUBSTEP_S);
      vDown = vDown + (g + ay) * SUBSTEP_S;
      lon +=
        (vHoriz * SUBSTEP_S) / (KERBIN_RADIUS * Math.cos(-0.05 * DEG)) / DEG;
      agl -= vDown * SUBSTEP_S;
    }
  }
  agl = 0;
  const last = frames[frames.length - 1];
  const settled = frame((last?.t ?? 0) + 1, true);
  frames.push({ ...settled, vDown: 0, vHoriz: 0, terminal: settled.terminal });
  return frames;
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
  const speed = Math.hypot(f.vDown, f.vHoriz);
  // What the mod predicts: the drag-free conic walked to the surface, which the drag pulls back toward the craft as it slows.
  const drift = ballisticDrift(
    f.aglMeters,
    f.vDown,
    f.vHoriz,
    KERBIN_MU / (KERBIN_RADIUS + f.asl) ** 2,
  );
  const pp = {
    lat: f.lat,
    lon: f.lon + drift / (KERBIN_RADIUS * Math.cos(f.lat * DEG)) / DEG,
  };
  const footprint = coneFootprint(
    f.aglMeters,
    f.vDown,
    f.vHoriz,
    KERBIN_RADIUS,
  );
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
  const touchdown = terminalAt(surfaceAsl(world), CANOPY_TERMINAL);
  const identity = channels["vessel.identity"];
  return {
    ...channels,
    "system.bodies": {
      bodies: [
        {
          name: "Kerbin",
          index: 1,
          parentIndex: 0,
          radius: KERBIN_RADIUS,
          gravParameter: KERBIN_MU,
          atmosphere: { depth: 70_000, hasOxygen: true },
          hasOcean: true,
          orbit: null,
        },
      ],
    },
    "vessel.identity": {
      ...(typeof identity === "object" && identity !== null ? identity : {}),
      name: "Reentry Capsule",
      parentBodyIndex: 1,
      situation: f.landed ? (world.ocean ? 1 : 0) : 6,
    },
    "vessel.orbit": {
      referenceBodyIndex: 1,
      sma: 610_000,
      ecc: 0.005,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 10,
      mu: KERBIN_MU,
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
