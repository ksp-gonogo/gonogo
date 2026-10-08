#!/usr/bin/env tsx
/**
 * Synthesize a physically-grounded Mun descent and emit (a) a 1 Hz SYNTHETIC
 * time-series ndjson for the record, and (b) `_stream` render fixtures
 * (high / ignition / approach / final / landed) for the Landing widget render
 * harness. The descent ends on a settled LANDED frame (situation Landed, motion
 * nulled) so the widget reads landed, not a stale descent countdown.
 *
 * The trajectory is integrated forward with the widget's OWN full-vector burn
 * solve (`solveSuicideBurn`) driving when the suicide burn starts, so the data
 * is self-consistent with what the widget re-derives. Terrain (slope / roughness
 * / biome at the predicted point) is swept from rough-and-steep high up to
 * smooth-and-flat near touchdown, so the reticle's hazard verdict walks
 * DIVERT -> MARGINAL -> SAFE across the descent, a real UX story, not random.
 *
 * NOT captured: model-generated. Run:
 *   pnpm --filter @ksp-gonogo/components exec tsx scripts/synthesize-landing-descent.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Frame } from "./landingDescentModel";
import {
  channelsFor,
  DEG,
  fixtureFromChannels,
  groundTrackDistances,
  integrate,
  MU,
  predictedPoint,
  R,
  streamFixture,
} from "./landingDescentModel";

export type { Frame };
export { integrate, predictedPoint, streamFixture };

// ── Terrain-type showcase: distinct relief along the ground track ────────────

interface TerrainPreset {
  name: string;
  slope: number;
  heading: number;
  roughness: number;
  biome: string;
  /** Metres of relief at a distance in metres downrange of the site. */
  relief: (downrange: number) => number;
  note: string;
}

const gauss = (d: number, s: number) => Math.exp(-((d / s) ** 2) / 2);

const PRESETS: TerrainPreset[] = [
  {
    name: "flat-plains",
    slope: 1,
    heading: 90,
    roughness: 15,
    biome: "Lowlands",
    relief: (x) => 1.2 * Math.sin(x * 0.2),
    note: "Flat plains: near-zero slope, smooth => SAFE",
  },
  {
    name: "gentle-slope",
    slope: 9,
    heading: 110,
    roughness: 45,
    biome: "Midlands",
    relief: (x) => Math.tan(9 * DEG) * Math.sin(110 * DEG) * x,
    note: "Gentle slope (~9deg) => MARGINAL on slope",
  },
  {
    name: "steep-slope",
    slope: 22,
    heading: 200,
    roughness: 70,
    biome: "Highlands",
    relief: (x) => Math.tan(22 * DEG) * Math.sin(200 * DEG) * x,
    note: "Steep slope (>15deg) => DIVERT on slope",
  },
  {
    name: "crater-field",
    slope: 4,
    heading: 90,
    roughness: 220,
    biome: "Midlands",
    relief: (x) => -30 * gauss(x, 32) + 11 * gauss(x - 56, 10),
    note: "Crater: deep central dip + raised rim => MARGINAL on roughness",
  },
  {
    name: "ridge-mountainous",
    slope: 18,
    heading: 300,
    roughness: 320,
    biome: "Highlands",
    relief: (x) => 26 * gauss(x, 22) + 2 * Math.sin(x * 0.1),
    note: "Sharp ridge / mountainous => DIVERT (slope + roughness)",
  },
  {
    name: "boulder-rough",
    slope: 3,
    heading: 90,
    roughness: 200,
    biome: "Midlands",
    relief: (x) =>
      6 * Math.sin(x * 0.5) + 4 * Math.cos(x * 0.33) + 3 * Math.sin(x * 0.7),
    note: "Boulder-rough: low slope, high residual roughness => MARGINAL on roughness",
  },
];

/** A single slow near-touchdown state, so the verdict tracks the TERRAIN not speed. */
const SHOWCASE_FRAME: Frame = {
  t: 0,
  aglMeters: 60,
  vDown: 1.3,
  vHoriz: 0.4,
  lat: 0,
  lon: 0.001,
  burning: true,
};

/** One channel block of a synthesised frame, or a failure naming the gap. */
function channel(
  frame: Record<string, unknown>,
  topic: string,
): Record<string, unknown> {
  const block = frame[topic];
  if (typeof block !== "object" || block === null) {
    throw new Error(`the synthesised frame carries no ${topic}`);
  }
  return block as Record<string, unknown>;
}

/** The ground-track strip a showcase frame carries: the preset's relief along it, through the site's own elevation. */
function showcaseTrack(preset: TerrainPreset): {
  groundTrackDistances: number[];
  groundTrackElevations: number[];
} {
  const pp = predictedPoint(SHOWCASE_FRAME);
  const drift =
    (pp.lon - SHOWCASE_FRAME.lon) *
    DEG *
    R *
    Math.cos(SHOWCASE_FRAME.lat * DEG);
  const distances = groundTrackDistances(drift);
  return {
    groundTrackDistances: distances,
    groundTrackElevations: distances.map(
      (d) => 120 + preset.relief(d - drift) - preset.relief(0),
    ),
  };
}

function showcaseFixture(preset: TerrainPreset): Record<string, unknown> {
  const ch = channelsFor(SHOWCASE_FRAME, 2);
  channel(ch, "vessel.surface").biome = preset.biome;
  ch["vessel.landing"] = {
    ...channel(ch, "vessel.landing"),
    predictedSlopeAngle: preset.slope,
    predictedSlopeHeading: preset.heading,
    predictedRoughness: preset.roughness,
    predictedBiome: preset.biome,
    ...showcaseTrack(preset),
  };
  return fixtureFromChannels(ch, preset.name, preset.note);
}

// ── Emit (only when this script is run directly, not when imported) ───────────
function emitAll(): void {
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
  // ignition (first burning frame: hot band lit, still fast so DIVERT), approach
  // (slow final-approach over a MARGINAL slope), and final (SAFE soft touchdown).
  const high =
    frames.find((f) => !f.burning && f.aglMeters <= 7500) ?? frames[0];
  const ignition =
    frames.find((f) => f.burning) ?? frames[Math.floor(frames.length / 2)];
  const approach =
    frames.find((f) => f.burning && f.aglMeters <= 150) ??
    frames[frames.length - 2];
  const final =
    frames.find((f) => f.aglMeters <= 40) ?? frames[frames.length - 1];
  // The settled touched-down frame (last): situation Landed, all motion nulled, the widget shows the landed state, no stale descent countdown.
  const landedFrame = frames.find((f) => f.landed) ?? frames[frames.length - 1];

  const fixDir = resolve(
    import.meta.dirname,
    "../src/LandingStatus/__render__",
  );
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
  writeFileSync(
    resolve(fixDir, "descent-landed.json"),
    `${JSON.stringify(streamFixture(landedFrame, 4, "descent-landed", "Touched down: situation Landed, motion nulled -> settled landed state, no stale countdown."), null, 2)}\n`,
  );

  // Terrain-type showcase: one near-touchdown frame per distinct terrain, so the reticle relief + verdict range is visible across flat/slope/crater/ridge/etc.
  const showcaseDir = resolve(
    import.meta.dirname,
    "../src/LandingStatus/__render_terrains__",
  );
  mkdirSync(showcaseDir, { recursive: true });
  for (const preset of PRESETS) {
    writeFileSync(
      resolve(showcaseDir, `${preset.name}.json`),
      `${JSON.stringify(showcaseFixture(preset), null, 2)}\n`,
    );
  }

  console.log(`frames: ${frames.length}`);
  console.log(
    `high: agl=${Math.round(high.aglMeters)} ignition: agl=${Math.round(ignition.aglMeters)} burning=${ignition.burning} final: agl=${Math.round(final.aglMeters)}`,
  );
  console.log(
    `ndjson -> ${resolve(ndjsonDir, "synthetic-descent-mun.ndjson")}`,
  );
  console.log(`fixtures -> ${fixDir}`);
  console.log(`terrain showcase (${PRESETS.length}) -> ${showcaseDir}`);
}

// Run the file-writing only when invoked directly (`tsx synthesize-landing-descent.ts`), so importing `integrate`/`streamFixture` (e.g. from the gif renderer) is side-effect-free.
if (process.argv[1]?.includes("synthesize-landing-descent")) emitAll();
