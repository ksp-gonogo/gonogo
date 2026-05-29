// Generate a synthetic-but-structured SCANsat fixture for the MapView widget.
//
// Cell order matches the decoder (`packages/data/src/scansat/scanDecode.ts`):
//   idx = ilon*180 + ilat,  ilon=(lon+540)%360 (ilon 0 → lon -180),
//   ilat=(lat+270)%180 (ilat 0 → lat -90, the SOUTH pole).
//
// Reproducible: `node gen-scansat-fixture.mjs` from the repo root (or any cwd —
// the output path is resolved relative to this file). Writes
// `kerbin-scansat.json` next to this script.
//
// Data is deliberately asymmetric N/S + one-hemisphere ocean + a mountains
// fingerprint so a flipped axis or wrong longitude offset shows up in the
// render rather than hiding. Mirrors the Scanning widget's fixture so the two
// agree on orientation; this one ADDS scan.heightGrid (elevation shading), a
// second mask layer (Biome=8), a multi-vessel scan.scanningVessels (footprint
// overlay), and the orbit/vessel keys MapView needs to draw its base map +
// vessel marker + prediction.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 360;
const H = 180;

// ── Biome table (name, displayName, 0xRRGGBB) — same palette as Scanning ──
const BIOMES = [
  { name: "Water", displayName: "Water", colour: 0x1a3a6b },
  { name: "Shores", displayName: "Shores", colour: 0x2f6f8f },
  { name: "Grasslands", displayName: "Grasslands", colour: 0x3a7d2a },
  { name: "Highlands", displayName: "Highlands", colour: 0x6b6033 },
  { name: "Mountains", displayName: "Mountains", colour: 0x8a8a8a },
  { name: "Tundra", displayName: "Tundra", colour: 0x9b8b6b },
  { name: "IceCaps", displayName: "Ice Caps", colour: 0xe6f1ff },
];
const B = Object.fromEntries(BIOMES.map((b, i) => [b.name, i]));

// Two mountain "ranges" (lat band, lon band) used by BOTH the biome map and
// the elevation grid so the topo shading and the biome colours agree.
function inOcean(lat, lon) {
  // One-hemisphere ocean (physical lon -150..-20) across mid latitudes —
  // with Kerbin's +90° longitudeOffset this rotates to the render's RIGHT of
  // centre, not the left, so a missing/extra offset is visible.
  return lon >= -150 && lon < -20 && Math.abs(lat) < 55;
}
function inMountainsA(lat, lon) {
  // North-east range — the "fingerprint" patch.
  return lat >= 18 && lat <= 46 && lon >= 40 && lon <= 92;
}
function inMountainsB(lat, lon) {
  // South-west range — a second range so topo shows >1 structured feature.
  return lat >= -52 && lat <= -28 && lon >= 100 && lon <= 150;
}

function biomeAt(lat, lon) {
  // Asymmetric polar caps: south bigger (≤ -66°), north smaller (≥ 74°).
  if (lat <= -66) return B.IceCaps;
  if (lat >= 74) return B.IceCaps;
  if (inOcean(lat, lon)) {
    const edge = lon < -140 || lon >= -30 || Math.abs(lat) > 48;
    return edge ? B.Shores : B.Water;
  }
  if (inMountainsA(lat, lon) || inMountainsB(lat, lon)) return B.Mountains;
  const al = Math.abs(lat);
  if (al < 13) return B.Grasslands;
  if (al < 36) return B.Highlands;
  return B.Tundra;
}

// Elevation in metres above the reference radius. Ocean is a deep negative
// basin, mountains are sharp positive peaks, the rest ramps gently with
// |lat| so the gradient ramp shows a recognisable band structure.
function heightAt(lat, lon) {
  if (inOcean(lat, lon)) return -2200;
  if (inMountainsA(lat, lon)) return 5200;
  if (inMountainsB(lat, lon)) return 4400;
  if (lat <= -66 || lat >= 74) return 1800; // ice cap plateau
  const al = Math.abs(lat);
  // Gentle continental slope: highlands push up away from the equator.
  return Math.round(120 + al * 28);
}

const indices = new Uint8Array(W * H);
const heights = new Int16Array(W * H);
// Two mask layers: AltimetryHiRes (2) and Biome (8). Different swaths so the
// composite fog shows the union and the two channels are distinguishable.
const bitsHiRes = new Uint8Array((W * H + 7) >> 3);
const bitsBiome = new Uint8Array((W * H + 7) >> 3);

// AltimetryHiRes swath: physical lon [-120, 60) and |lat| <= 82.
function scannedHiRes(lat, lon) {
  return lon >= -120 && lon < 60 && Math.abs(lat) <= 82;
}
// Biome swath: a different, narrower band (physical lon [-60, 100), |lat|<=60)
// so the two layers don't perfectly overlap — proves layered compositing.
function scannedBiome(lat, lon) {
  return lon >= -60 && lon < 100 && Math.abs(lat) <= 60;
}

let scannedHi = 0;
let scannedBi = 0;
let minM = Infinity;
let maxM = -Infinity;
for (let ilon = 0; ilon < W; ilon++) {
  const lon = ilon - 180 + 0.5;
  for (let ilat = 0; ilat < H; ilat++) {
    const lat = ilat - 90 + 0.5;
    const idx = ilon * H + ilat;
    indices[idx] = biomeAt(lat, lon);
    const m = heightAt(lat, lon);
    heights[idx] = m;
    if (m < minM) minM = m;
    if (m > maxM) maxM = m;
    if (scannedHiRes(lat, lon)) {
      bitsHiRes[idx >> 3] |= 0x80 >> (idx & 7);
      scannedHi++;
    }
    if (scannedBiome(lat, lon)) {
      bitsBiome[idx >> 3] |= 0x80 >> (idx & 7);
      scannedBi++;
    }
  }
}
const hiResPct = (scannedHi / (W * H)) * 100;
const biomePct = (scannedBi / (W * H)) * 100;

const b64 = (buf) => Buffer.from(buf).toString("base64");
const b64i16 = (i16) =>
  Buffer.from(i16.buffer, i16.byteOffset, i16.byteLength).toString("base64");

// Coverage %: AltHiRes matched to its mask, Biome matched to its mask,
// LoRes scans wider, Anomaly/Resource plausible early values.
const coverage = {
  2: Math.round(hiResPct * 10) / 10, // AltimetryHiRes — matches mask
  1: Math.round(Math.min(hiResPct + 22, 98) * 10) / 10, // AltimetryLoRes wider
  8: Math.round(biomePct * 10) / 10, // Biome — matches mask
  16: 31.0, // Anomaly
  256: 7.4, // ResourceHiRes — early
};

// Anomalies — distinct lat/lons; flags consistent with Anomaly(16)/Detail(32)
// coverage > 0. KSC at its real position for the orientation check. A mix of
// known+detail / known-only / undiscovered.
const anomalies = [
  {
    name: "KSC",
    latitude: -0.0967,
    longitude: -74.5575,
    known: true,
    detail: true,
  },
  {
    name: "Monolith 00",
    latitude: 10.2,
    longitude: 30.4,
    known: true,
    detail: false,
  },
  {
    name: "Pyramids",
    latitude: 6.5,
    longitude: -71.2,
    known: true,
    detail: true,
  },
  {
    name: "Monolith 02",
    latitude: -38.4,
    longitude: 142.1,
    known: true,
    detail: false,
  },
  { name: "", latitude: -45.3, longitude: 121.6, known: false, detail: false },
];

// Multiple scanning vessels for the footprint overlay. Distinct trackColor,
// sub-points, sensor sets and in-range state. All kept clear of ±180° lon so
// the headline render reads cleanly (the antimeridian split is implemented but
// not exercised in the showcase frame).
const scanningVessels = [
  {
    vesselId: "scn-1",
    vesselName: "ScanSat Alpha",
    body: "Kerbin",
    subLatitude: 12.0,
    subLongitude: 35.0,
    altitude: 250000,
    sensors: [
      {
        type: 2,
        fov: 5,
        minAlt: 5000,
        maxAlt: 500000,
        bestAlt: 250000,
        inRange: true,
        bestRange: true,
      },
      {
        type: 8,
        fov: 5,
        minAlt: 5000,
        maxAlt: 500000,
        bestAlt: 250000,
        inRange: true,
        bestRange: false,
      },
    ],
    groundTrackWidthDeg: 6,
    groundTrackLonHalfDeg: 6.13,
    trackColor: { r: 0, g: 255, b: 200, a: 200 },
  },
  {
    vesselId: "scn-2",
    vesselName: "Polar Mapper",
    body: "Kerbin",
    subLatitude: -58.0,
    subLongitude: -40.0,
    altitude: 320000,
    sensors: [
      {
        type: 1,
        fov: 3,
        minAlt: 5000,
        maxAlt: 800000,
        bestAlt: 400000,
        inRange: true,
        bestRange: false,
      },
      {
        type: 256,
        fov: 2,
        minAlt: 70000,
        maxAlt: 250000,
        bestAlt: 150000,
        inRange: false,
        bestRange: false,
      },
    ],
    groundTrackWidthDeg: 9,
    groundTrackLonHalfDeg: 17.0,
    trackColor: { r: 255, g: 170, b: 40, a: 200 },
  },
  {
    // A vessel orbiting a DIFFERENT body — must be filtered out of the Kerbin
    // footprint overlay. Proves the v.body filter.
    vesselId: "scn-3",
    vesselName: "Mun Surveyor",
    body: "Mun",
    subLatitude: 5.0,
    subLongitude: 80.0,
    altitude: 30000,
    sensors: [
      {
        type: 2,
        fov: 4,
        minAlt: 5000,
        maxAlt: 100000,
        bestAlt: 25000,
        inRange: true,
        bestRange: true,
      },
    ],
    groundTrackWidthDeg: 7,
    groundTrackLonHalfDeg: 7.0,
    trackColor: { r: 120, g: 200, b: 255, a: 200 },
  },
];

// Kerbin LKO ~100 km circular, slight inclination so the prediction ground
// track is a visible sine across the map (not a flat equatorial line).
const orbitPatch = {
  startUT: 0,
  endUT: 1_000_000,
  patchStartTransition: "INITIAL",
  patchEndTransition: "FINAL",
  PeA: 100_000,
  ApA: 100_000,
  inclination: 28,
  eccentricity: 0,
  epoch: 0,
  period: 1962,
  argumentOfPeriapsis: 0,
  sma: 700_000,
  lan: 0,
  maae: 0,
  referenceBody: "Kerbin",
  semiLatusRectum: 700_000,
  semiMinorAxis: 700_000,
  closestEncounterBody: null,
};

const data = {
  _meta: {
    capturedAt: "2026-05-29",
    body: "Kerbin",
    synthetic: true,
    notes:
      "SYNTHETIC, hand-generated (no live SCANsat capture available) — replace " +
      "with a real capture when SCANsat is installed and a body scanned. " +
      "Structured asymmetrically (south ice cap > north, west-hemisphere ocean, " +
      "two mountain ranges, partial AltHiRes + Biome scan swaths) so an N/S axis " +
      "flip or wrong longitude offset is visible in the render. Adds heightGrid " +
      "(elevation shading), a second mask layer, a multi-vessel scanningVessels " +
      "(one on Mun, filtered out), 5 anomalies (mix of known/detail/undiscovered) " +
      "and Kerbin-LKO orbit/vessel keys for the base map + marker + prediction. " +
      "Cell order idx=ilon*180+ilat per scanDecode. Regenerate with " +
      "gen-scansat-fixture.mjs.",
  },
  // ── Vessel + orbit (Kerbin LKO) ──
  "v.body": "Kerbin",
  "v.biome": "Highlands",
  "v.lat": 12.0,
  "v.long": 35.0,
  "v.altitude": 100_000,
  "v.name": "ScanSat Alpha",
  "v.missionTime": 92340,
  "v.dynamicPressure": 0,
  "v.mach": 0,
  "v.surfaceSpeed": 2290,
  "v.verticalSpeed": 0,
  "o.orbitPatches": [orbitPatch],
  "o.maneuverNodes": [],
  "o.encounterExists": 0,
  "t.universalTime": 92340,
  "a.physicsMode": "patched_conics",
  "land.predictedLat": 0,
  "land.predictedLon": 0,
  // ── SCANsat ──
  "scan.available": true,
  "scan.scanningVessels": scanningVessels,
  "scan.anomalies[Kerbin]": anomalies,
  "scan.coverage[Kerbin,2]": coverage[2],
  "scan.coverage[Kerbin,1]": coverage[1],
  "scan.coverage[Kerbin,8]": coverage[8],
  "scan.coverage[Kerbin,16]": coverage[16],
  "scan.coverage[Kerbin,256]": coverage[256],
  "scan.biomeGrid[Kerbin]": {
    width: W,
    height: H,
    biomes: BIOMES.map((b) => ({
      name: b.name,
      displayName: b.displayName,
      colour: b.colour,
    })),
    indices: b64(indices),
  },
  "scan.heightGrid[Kerbin]": {
    width: W,
    height: H,
    minMetres: minM,
    maxMetres: maxM,
    heights: b64i16(heights),
  },
  "scan.maskBitmap[Kerbin,2]": {
    width: W,
    height: H,
    type: 2,
    bits: b64(bitsHiRes),
  },
  "scan.maskBitmap[Kerbin,8]": {
    width: W,
    height: H,
    type: 8,
    bits: b64(bitsBiome),
  },
};

const outPath = join(HERE, "kerbin-scansat.json");
writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(
  "wrote MapView SCANsat fixture →",
  outPath,
  "\n  AltHiRes scanned %:",
  coverage[2],
  "| Biome scanned %:",
  coverage[8],
  "| height min/max m:",
  minM,
  maxM,
  "| biome bytes:",
  indices.length,
  "| height bytes:",
  heights.byteLength,
);
