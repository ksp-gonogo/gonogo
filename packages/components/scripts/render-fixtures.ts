#!/usr/bin/env tsx
/**
 * Render every Ship Map fixture under `src/ShipMap/__fixtures__/` to an
 * SVG file in `local_docs/ship-map-renders/`. Used for visually iterating
 * on the diagram without running KSP / the dashboard.
 *
 * Run with `pnpm --filter @gonogo/components render-ship-map`.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PartState, PartStateModule, VesselTopology } from "@gonogo/core";
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

/**
 * Optional partState sidecar — keyed by stringified `flightId` →
 * `PartStateModule[]`. The harness loads `<fixture>.partState.json`
 * when present so the rendered SVG exercises the engine-flame /
 * parachute-canopy / deploy-chevron overlays. Real captures pull
 * `v.partState[fid]` from Telemachus; for demo purposes (where no
 * live capture is available) a hand-written sidecar drives the same
 * code path.
 */
type PartStateSidecar = Record<string, PartStateModule[]>;

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const entries = await readdir(FIXTURES_DIR);
  const fixtures = entries.filter((e) => e.endsWith(".json"));
  if (fixtures.length === 0) {
    console.error(`No fixtures found in ${FIXTURES_DIR}`);
    process.exit(1);
  }

  for (const name of fixtures) {
    if (name.endsWith(".partState.json")) continue;
    const raw = await readFile(join(FIXTURES_DIR, name), "utf8");
    const fixture = JSON.parse(raw) as Fixture;
    const sidecarPath = join(
      FIXTURES_DIR,
      name.replace(/\.json$/, ".partState.json"),
    );
    let sidecar: PartStateSidecar | undefined;
    if (existsSync(sidecarPath)) {
      sidecar = JSON.parse(await readFile(sidecarPath, "utf8")) as
        PartStateSidecar;
    }
    const parts = fixtureToShipMapParts(fixture, sidecar);
    const svg = renderShipMapToSvg(parts, { width: 800, height: 800 });
    const outName = name.replace(/\.json$/, ".svg");
    const outPath = join(OUT_DIR, outName);
    await writeFile(outPath, svg, "utf8");
    const stateNote = sidecar ? " (partState)" : "";
    console.log(
      `  ${outName.padEnd(48)} ${String(parts.length).padStart(4)} parts${stateNote}`,
    );
  }

  console.log(`\nRendered ${fixtures.length} fixtures → ${OUT_DIR}`);
}

function fixtureToShipMapParts(
  fixture: Fixture,
  sidecar?: PartStateSidecar,
): ShipMapPart[] {
  const topo = fixture["v.topology"];
  const { useX } = pickLateralAxis(topo.parts);
  return topo.parts.map((p) => {
    const modules = sidecar?.[String(p.flightId)];
    const partState: PartState | undefined = modules
      ? { seq: 0, modules }
      : undefined;
    return buildShipMapPart(p, undefined, undefined, useX, partState);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
