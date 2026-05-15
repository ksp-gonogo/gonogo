#!/usr/bin/env tsx
/**
 * Render every Ship Map fixture under `src/ShipMap/__fixtures__/` to an
 * SVG file in `local_docs/ship-map-renders/`. Used for visually iterating
 * on the diagram without running KSP / the dashboard.
 *
 * Run with `pnpm --filter @gonogo/components render-ship-map`.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { VesselTopology } from "@gonogo/core";
import { renderShipMapToSvg } from "../src/ShipMap/render";
import {
  buildShipMapPart,
  pickLateralAxis,
  type ShipMapPart,
} from "../src/ShipMap/shipTopology";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(HERE, "../src/ShipMap/__fixtures__");
const OUT_DIR = resolve(HERE, "../../../local_docs/ship-map-renders");

interface Fixture {
  "v.topology": VesselTopology;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const entries = await readdir(FIXTURES_DIR);
  const fixtures = entries.filter((e) => e.endsWith(".json"));
  if (fixtures.length === 0) {
    console.error(`No fixtures found in ${FIXTURES_DIR}`);
    process.exit(1);
  }

  for (const name of fixtures) {
    const raw = await readFile(join(FIXTURES_DIR, name), "utf8");
    const fixture = JSON.parse(raw) as Fixture;
    const parts = fixtureToShipMapParts(fixture);
    const svg = renderShipMapToSvg(parts, { width: 800, height: 800 });
    const outName = name.replace(/\.json$/, ".svg");
    const outPath = join(OUT_DIR, outName);
    await writeFile(outPath, svg, "utf8");
    console.log(
      `  ${outName.padEnd(48)} ${String(parts.length).padStart(4)} parts`,
    );
  }

  console.log(`\nRendered ${fixtures.length} fixtures → ${OUT_DIR}`);
}

function fixtureToShipMapParts(fixture: Fixture): ShipMapPart[] {
  const topo = fixture["v.topology"];
  const { useX } = pickLateralAxis(topo.parts);
  return topo.parts.map((p) => buildShipMapPart(p, undefined, undefined, useX));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
