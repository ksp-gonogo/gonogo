#!/usr/bin/env tsx
/**
 * Regenerate every generated Landing Status scene in the `_stream` Sitrep
 * format, so a regeneration reproduces the committed files exactly:
 *
 * - the six `__fixtures__` scenes (five Mun descents built from the shared
 *   `streamFixture(frame)`, and a hand-built Kerbin atmospheric reentry whose
 *   different body and atmosphere fields take the widget's atmospheric board
 *   rather than the vacuum reticle), plus the same descent with its stream gone
 *   quiet
 * - the five `__render__` descents and six `__render_terrains__` showcase scenes
 *   from `synthesize-landing-descent.ts`
 * - the three `__render_currency__` scenes (one approach, current, without a
 *   link, and with its readings gone stale) and the Kerbin chute scene
 *
 * `generatedScenes()` is the whole set, which `generatedScenes.test.ts` holds
 * the committed files to.
 *
 * Run, then format: pnpm --filter @ksp-gonogo/components exec tsx scripts/gen-landing-status-fixtures.ts && pnpm exec biome format --write packages/components/src/LandingStatus
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  type Frame,
  greatCircleMeters,
  groundTrackDistances,
  groundTrackElevations,
  roundedScene,
  sceneMeta,
  streamFixture,
} from "./landingDescentModel";
import { DERIVED_NOTES } from "./landingFixtureProse";
import {
  descentScenes,
  type GeneratedScene,
  showcaseScenes,
} from "./synthesize-landing-descent";

const ROOT = resolve(import.meta.dirname, "../src/LandingStatus");

type Json = Record<string, unknown>;

/** A Mun descent frame (vDown is positive-down, matching Frame). */
function munFrame(over: Partial<Frame>): Frame {
  return {
    t: 0,
    aglMeters: 1000,
    vDown: 20,
    vHoriz: 0,
    lat: 0,
    lon: 0,
    burning: false,
    ...over,
  };
}

/** The stream block of a scene, which every generated scene carries. */
function streamOf(fixture: Json): { emits: Json[] } & Json {
  const stream = fixture._stream;
  if (
    typeof stream !== "object" ||
    stream === null ||
    !("emits" in stream) ||
    !Array.isArray(stream.emits)
  ) {
    throw new Error("the scene carries no stream");
  }
  return stream as { emits: Json[] } & Json;
}

export function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The record at `key` of a scene's block, asserted present. */
export function recordAt(parent: Json, key: string): Json {
  const found = parent[key];
  if (!isRecord(found)) throw new Error(`the scene carries no ${key}`);
  return found;
}

/** The number at `key` of a scene's block, asserted present. */
export function numberAt(parent: Json, key: string): number {
  const found = parent[key];
  if (typeof found !== "number") {
    throw new Error(`the scene carries no number ${key}`);
  }
  return found;
}

/** The emit a scene carries for one channel, asserted present. */
export function emitOf(fixture: Json, channel: string): Json {
  const stream = streamOf(fixture);
  const found = stream.emits.find((e) => e.channel === channel);
  if (!found) throw new Error(`the scene carries no ${channel}`);
  return found;
}

/** The first body of a scene's `system.bodies`, which the stock descents leave without its gravity and rotation. */
function withBodyFigures(
  fixture: Json,
  figures: { surfaceGravity: number; rotationPeriod: number },
): Json {
  const bodies = recordAt(emitOf(fixture, "system.bodies"), "value").bodies;
  if (!Array.isArray(bodies)) throw new Error("the scene carries no bodies");
  Object.assign(bodies[0], figures);
  return fixture;
}

// ── The Mun scenarios (built from the shared streamFixture) ───────────────────
const MUN_FIGURES = {
  surfaceGravity: 0.166056700098353,
  rotationPeriod: 138984.376574476,
};

const MUN: Array<{
  scenario: string;
  oneWay: number;
  notes: string;
  frame: Frame;
}> = [
  {
    scenario: "pre-burn-cruise",
    oneWay: 4,
    notes:
      "High cruise above the Mun (~45 km AGL), coasting toward the predicted site far downrange: the full descent picture with the site near the reticle rim, well before the burn.",
    frame: munFrame({ aglMeters: 45000, vDown: 18.3, vHoriz: 200 }),
  },
  {
    scenario: "suicide-burn-approaching",
    oneWay: 4,
    notes:
      "Mid descent (~2.8 km AGL, 42 m/s down) under STAGED delay: the commit clock is live and the burn is coming up; full metric grid, terrain + cross-section, commit point.",
    frame: munFrame({
      aglMeters: 2800,
      vDown: 42.5,
      vHoriz: 50,
      burning: true,
    }),
  },
  {
    scenario: "final-approach-mun",
    oneWay: 0,
    notes:
      "Very low final approach (~180 m AGL, 8 m/s down) on a LIVE link: the suicide-burn ignition countdown is urgent (role=alert), the vessel sits low over the site.",
    frame: munFrame({ aglMeters: 180, vDown: 8.1, vHoriz: 2, burning: true }),
  },
  {
    scenario: "descending-too-fast-to-stop",
    oneWay: 4,
    notes:
      "Very high vertical speed on the Mun (~12 km AGL, 350 m/s down): far too fast for the available thrust to arrest in the remaining altitude, so the board reads a hard DIVERT / over-speed descent.",
    frame: munFrame({ aglMeters: 12000, vDown: 350, vHoriz: 100 }),
  },
  {
    scenario: "landed-mun",
    oneWay: 4,
    notes:
      "Touched down on the Mun: situation Landed, motion nulled. The touchdown-confirmed view: LANDED hero, plots showing the vessel on the site, SAFE verdict, TWR + fuel, no live countdowns.",
    frame: munFrame({
      aglMeters: 0,
      vDown: 0,
      vHoriz: 0,
      burning: false,
      landed: true,
    }),
  },
];

function munScenes(): GeneratedScene[] {
  return MUN.map(({ scenario, oneWay, notes, frame }) => ({
    path: `__fixtures__/${scenario}.json`,
    fixture: withBodyFigures(
      streamFixture(frame, oneWay, scenario, notes),
      MUN_FIGURES,
    ),
  }));
}

/** The approaching descent with its stream gone quiet: the same readings, flagged as no longer arriving. */
function linkLostScene(approaching: Json): GeneratedScene {
  const scenario = "suicide-burn-approaching-link-lost";
  const stream = streamOf(approaching);
  return {
    path: `__fixtures__/${scenario}.json`,
    fixture: {
      _meta: sceneMeta(scenario, DERIVED_NOTES[scenario]),
      _stream: { ...stream, stopsArriving: true },
    },
  };
}

// ── The Kerbin atmospheric scenes (hand-built; different body + atmosphere) ───
const EMITTED = [
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

const KERBIN_INDEX = 1;
const KERBIN_MU = 3.5316e12;
const KERBIN_RADIUS = 600000;

interface KerbinScene {
  scenario: string;
  path: string;
  /** Extra figures on the body, where the scene states them. */
  bodyFigures?: { surfaceGravity: number; rotationPeriod: number };
  vesselId: string;
  vesselName: string;
  orbit: { sma: number; ecc: number };
  flight: Json;
  surface: Json;
  gear: boolean;
  /** The landing group, before any ground-track strip is added. */
  landing: Json;
  /** Whether the scene states a predicted site, and so carries a ground-track strip along the way to it. */
  strip?: boolean;
}

function kerbinScene(spec: KerbinScene): GeneratedScene {
  const flight = spec.flight as { latitude: number; longitude: number };
  const landing: Json = { ...spec.landing };
  if (spec.strip) {
    const drift = greatCircleMeters(
      flight.latitude,
      flight.longitude,
      numberAt(landing, "predictedLatitude"),
      numberAt(landing, "predictedLongitude"),
      KERBIN_RADIUS,
    );
    const distances = groundTrackDistances(drift);
    landing.groundTrackDistances = roundedScene(distances);
    landing.groundTrackElevations = roundedScene(
      groundTrackElevations(
        distances,
        drift,
        numberAt(landing, "predictedTerrainElevation"),
      ),
    );
  }
  const channels: Record<string, unknown> = {
    "system.bodies": {
      bodies: [
        {
          name: "Kerbin",
          index: KERBIN_INDEX,
          parentIndex: 0,
          radius: KERBIN_RADIUS,
          orbit: null,
          ...spec.bodyFigures,
        },
      ],
    },
    "vessel.identity": {
      vesselId: spec.vesselId,
      name: spec.vesselName,
      vesselType: 0,
      situation: 6, // SubOrbital
      parentBodyIndex: KERBIN_INDEX,
      launchUt: null,
    },
    "vessel.orbit": {
      referenceBodyIndex: KERBIN_INDEX,
      sma: spec.orbit.sma,
      ecc: spec.orbit.ecc,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 10,
      mu: KERBIN_MU,
      horizon: { kind: 1, trajectoryKind: 1 },
    },
    "vessel.flight": spec.flight,
    "vessel.surface": spec.surface,
    "vessel.propulsion": {
      totalMass: 5,
      dryMass: 3,
      currentThrust: 0,
      availableThrust: 18,
    },
    "vessel.control": { gear: spec.gear, brakes: false },
    "dv.summary": { totalDvActual: 400, totalDvVac: 450 },
    "comms.delay": { source: 1, oneWaySeconds: 1.2 },
    // Atmospheric-aware landing estimate (terminal-velocity model): the presence
    // of terminalVelocity flips the widget to its atmospheric board (aerobraking
    // note + ambient section), NOT the vacuum suicide-burn reticle.
    "vessel.landing": landing,
  };
  const emits = EMITTED.map((channel) =>
    channel === "vessel.orbit"
      ? { channel, value: channels[channel], meta: { quality: 1 } }
      : { channel, value: channels[channel] },
  );
  return {
    path: spec.path,
    fixture: {
      _meta: sceneMeta(spec.scenario, DERIVED_NOTES[spec.scenario]),
      _stream: { pinnedUt: 10, emits },
    },
  };
}

function kerbinScenes(): GeneratedScene[] {
  return [
    kerbinScene({
      scenario: "kerbin-reentry-atmospheric",
      path: "__fixtures__/kerbin-reentry-atmospheric.json",
      bodyFigures: {
        surfaceGravity: 1.00034160493135,
        rotationPeriod: 21549.4251830899,
      },
      vesselId: "synthetic-reentry",
      vesselName: "Synthetic Reentry",
      orbit: { sma: 680000, ecc: 0.12 },
      flight: {
        latitude: -0.047,
        longitude: -74.623,
        altitudeAsl: 28000,
        altitudeTerrain: 28000,
        verticalSpeed: -210.4,
        surfaceSpeed: 220,
        orbitalSpeed: 220,
        atmDensity: 0.087,
        atmosphericTemperature: 240.15,
        externalTemperature: 1850,
        mach: 0.708,
      },
      surface: { biome: "Shores", landedAt: null, heightFromTerrain: 28000 },
      gear: false,
      landing: {
        outcome: "atmosphere-modelled",
        sampleSource: null,
        terminalVelocity: 220,
        projectedTouchdownSpeed: 8.4,
        atmosphericTimeToImpact: 95,
        descentRegime: "hypersonic",
        parachuteState: "stowed",
        dragToWeightRatio: 1,
      },
    }),
    kerbinScene({
      scenario: "atmospheric-final-approach-chute",
      path: "__render_atmospheric__/final-approach-chute.json",
      vesselId: "atmo-final",
      vesselName: "Reentry Capsule",
      orbit: { sma: 610000, ecc: 0.005 },
      flight: {
        latitude: -0.05,
        longitude: -74.6,
        altitudeAsl: 1500,
        altitudeTerrain: 1500,
        verticalSpeed: -9,
        surfaceSpeed: 11,
        orbitalSpeed: 11,
        atmDensity: 1,
        atmosphericTemperature: 287.15,
        externalTemperature: 295,
        mach: 0.032,
      },
      surface: {
        biome: "Grasslands",
        landedAt: null,
        heightFromTerrain: 1500,
      },
      gear: true,
      landing: {
        outcome: "atmosphere-modelled",
        sampleSource: "predicted",
        predictedLatitude: -0.048,
        predictedLongitude: -74.585,
        predictedTerrainElevation: 70,
        predictedSlopeAngle: 4.5,
        predictedSlopeHeading: 120,
        predictedRoughness: 40,
        roughnessFootprintMeters: 60,
        slopeSampleRadiusMeters: 100,
        predictedBiome: "Grasslands",
        terminalVelocity: 9.5,
        projectedTouchdownSpeed: 8.2,
        atmosphericTimeToImpact: 165,
        descentRegime: "at-terminal",
        parachuteState: "deployed",
        dragToWeightRatio: 1.341,
      },
      strip: true,
    }),
  ];
}

// ── The currency scenes: the final approach, with what the link says changed ──
/** The `__render__` approach scene, restated as a currency scene. */
function currencyScene(
  approach: Json,
  scenario: string,
  file: string,
  change: (stream: { emits: Json[] }) => void,
): GeneratedScene {
  const copy = structuredClone(approach) as Json;
  const stream = streamOf(copy);
  change(stream);
  return {
    path: `__render_currency__/${file}.json`,
    fixture: {
      _meta: sceneMeta(scenario, DERIVED_NOTES[scenario]),
      _stream: stream,
    },
  };
}

function currencyScenes(approach: Json): GeneratedScene[] {
  return [
    currencyScene(approach, "currency-live", "live-descent", () => {}),
    currencyScene(approach, "currency-no-link", "no-link", (stream) => {
      const delay = stream.emits.find((e) => e.channel === "comms.delay");
      if (!delay) throw new Error("the scene carries no comms.delay");
      recordAt(delay, "value").oneWaySeconds = null;
    }),
    currencyScene(
      approach,
      "currency-stale-mid-descent",
      "readings-gone-stale-mid-descent",
      (stream) => {
        for (const channel of ["vessel.flight", "vessel.surface"]) {
          const emit = stream.emits.find((e) => e.channel === channel);
          if (emit) emit.meta = { validAt: -600, deliveredAt: -600 };
        }
      },
    ),
  ];
}

/** Every generated scene, by path under `src/LandingStatus`. */
export function generatedScenes(): GeneratedScene[] {
  const descents = descentScenes();
  const approach = descents.find(
    (s) => s.path === "__render__/descent-approach.json",
  );
  const mun = munScenes();
  const approaching = mun.find(
    (s) => s.path === "__fixtures__/suicide-burn-approaching.json",
  );
  if (!approach || !approaching) {
    throw new Error("the scenes the derived ones start from are missing");
  }
  return [
    ...mun,
    linkLostScene(approaching.fixture),
    ...kerbinScenes(),
    ...descents,
    ...showcaseScenes(),
    ...currencyScenes(approach.fixture),
  ];
}

if (process.argv[1]?.includes("gen-landing-status-fixtures")) {
  for (const { path, fixture } of generatedScenes()) {
    const file = resolve(ROOT, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`wrote ${path}`);
  }
}
