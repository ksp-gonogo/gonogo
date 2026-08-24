#!/usr/bin/env tsx
/**
 * Regenerate the six `LandingStatus/__fixtures__/*.json` scenarios in the
 * `_stream` Sitrep format (the same envelope the working `__render__/*.json`
 * use). They were stale flat-key fixtures (`v.body`,
 * `v.heightFromTerrain`, `land.*`) that the Sitrep-migrated LandingStatus no
 * longer reads, so the `landing-status-widget` visual config rendered the
 * OFFLINE empty state. Driving the real Sitrep topics leaves offline and
 * renders each scenario's rich UI.
 *
 * Five scenarios are Mun descents built from the shared `streamFixture(frame)`
 * (same machinery as __render__), tuned to each note's state. The sixth is a
 * hand-built Kerbin atmospheric reentry (different body + atmosphere fields, so
 * the widget takes its atmospheric-aware board rather than the vacuum reticle).
 *
 * Run: pnpm --filter @ksp-gonogo/components exec tsx scripts/gen-landing-status-fixtures.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Frame, streamFixture } from "./synthesize-landing-descent";

const OUT = resolve(import.meta.dirname, "../src/LandingStatus/__fixtures__");

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

// ── The five Mun scenarios (built from the shared streamFixture) ──────────────
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
    scenario: "high-speed-no-solution",
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

// ── The Kerbin atmospheric reentry (hand-built; different body + atmosphere) ──
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

const KERBIN_INDEX = 1;
const KERBIN_MU = 3.5316e12;
const KERBIN_RADIUS = 600000;

function kerbinReentryFixture(): Record<string, unknown> {
  const agl = 28000;
  const channels: Record<string, unknown> = {
    "system.bodies": {
      bodies: [
        {
          name: "Kerbin",
          index: KERBIN_INDEX,
          parentIndex: 0,
          radius: KERBIN_RADIUS,
          orbit: null,
        },
      ],
    },
    "vessel.identity": {
      vesselId: "synthetic-reentry",
      name: "Synthetic Reentry",
      vesselType: 0,
      situation: 6, // SubOrbital
      parentBodyIndex: KERBIN_INDEX,
      launchUt: null,
    },
    "vessel.orbit": {
      referenceBodyIndex: KERBIN_INDEX,
      sma: 680000,
      ecc: 0.12,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 10,
      mu: KERBIN_MU,
    },
    "vessel.flight": {
      latitude: -0.047,
      longitude: -74.623,
      altitudeAsl: agl,
      altitudeTerrain: agl,
      verticalSpeed: -210.4,
      surfaceSpeed: 220,
      orbitalSpeed: 220,
      atmDensity: 0.087,
      atmosphericTemperature: 240.15,
      externalTemperature: 1850,
    },
    "vessel.surface": {
      biome: "Shores",
      landedAt: null,
      heightFromTerrain: agl,
    },
    "vessel.propulsion": {
      totalMass: 5,
      dryMass: 3,
      currentThrust: 0,
      availableThrust: 18,
    },
    "vessel.control": { gear: false, brakes: false },
    "dv.summary": { totalDvActual: 400, totalDvVac: 450 },
    "comms.delay": { source: 1, oneWaySeconds: 1.2 },
    // Atmospheric-aware landing estimate (terminal-velocity model): the presence
    // of terminalVelocity flips the widget to its atmospheric board (aerobraking
    // note + ambient section), NOT the vacuum suicide-burn reticle.
    "vessel.landing": {
      outcome: "atmosphere-modelled",
      sampleSource: null,
      terminalVelocity: 220,
      projectedTouchdownSpeed: 8.4,
      atmosphericTimeToImpact: 95,
      descentRegime: "hypersonic",
      parachuteState: "stowed",
    },
  };
  const emits = CARRIED.map((channel) =>
    channel === "vessel.orbit"
      ? { channel, value: channels[channel], meta: { quality: 1 } }
      : { channel, value: channels[channel] },
  );
  return {
    _meta: {
      scenario: "kerbin-reentry-atmospheric",
      synthetic: true,
      notes:
        "SYNTHETIC (model-generated, NOT captured). Kerbin reentry (~28 km, 210 m/s down) in an atmosphere, the atmospheric board: terminal velocity, projected touchdown, aerobraking regime + the ambient (air density / temp) section, suicide-burn demoted.",
    },
    _stream: { carriedChannels: CARRIED, pinnedUt: 10, emits },
  };
}

// ── Emit ──────────────────────────────────────────────────────────────────────
for (const { scenario, oneWay, notes, frame } of MUN) {
  const fixture = streamFixture(frame, oneWay, scenario, notes);
  writeFileSync(
    resolve(OUT, `${scenario}.json`),
    `${JSON.stringify(fixture, null, 2)}\n`,
  );
  console.log(`wrote ${scenario}.json (Mun, agl=${frame.aglMeters})`);
}
writeFileSync(
  resolve(OUT, "kerbin-reentry-atmospheric.json"),
  `${JSON.stringify(kerbinReentryFixture(), null, 2)}\n`,
);
console.log("wrote kerbin-reentry-atmospheric.json (Kerbin, atmospheric)");
