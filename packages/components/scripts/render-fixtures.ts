#!/usr/bin/env tsx
/**
 * Render every Vessel Schematic fixture under `src/VesselSchematic/__fixtures__/` to an
 * SVG file in `local_docs/renders/vessel-schematic/`. Used for visually iterating
 * on the diagram without running KSP / the dashboard.
 *
 * Run with `pnpm --filter @ksp-gonogo/components render-vessel-schematic`.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  PartState,
  PartStateModule,
  VesselTopology,
} from "@ksp-gonogo/core";
import { renderVesselSchematicToSvg } from "../src/VesselSchematic/render";
import {
  buildVesselSchematicPart,
  type VesselSchematicPart,
} from "../src/VesselSchematic/shipTopology";
import { pickView } from "../src/VesselSchematic/shipView";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(HERE, "../src/VesselSchematic/__fixtures__");
const OUT_DIR = resolve(HERE, "../../../local_docs/renders/vessel-schematic");

interface Fixture {
  "v.topology": VesselTopology;
}

/**
 * Optional partState sidecar: keyed by stringified `flightId` →
 * `PartStateModule[]`. The harness loads `<fixture>.partState.json`
 * when present so the rendered SVG exercises the engine-flame /
 * parachute-canopy / deploy-chevron overlays. Real captures pull
 * `v.partState[fid]` off the wire; for demo purposes (where no
 * live capture is available) a hand-written sidecar drives the same
 * code path.
 */
type PartStateSidecar = Record<string, PartStateModule[]>;

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const entries = await readdir(FIXTURES_DIR);
  const fixtures = entries.filter(
    (e) => e.endsWith(".json") && !e.endsWith(".partState.json"),
  );
  if (fixtures.length === 0) {
    console.error(`No fixtures found in ${FIXTURES_DIR}`);
    process.exit(1);
  }

  for (const name of fixtures) {
    const raw = await readFile(join(FIXTURES_DIR, name), "utf8");
    const fixture = JSON.parse(raw) as Fixture;
    const sidecarPath = join(
      FIXTURES_DIR,
      name.replace(/\.json$/, ".partState.json"),
    );
    let sidecar: PartStateSidecar | undefined;
    if (existsSync(sidecarPath)) {
      sidecar = JSON.parse(
        await readFile(sidecarPath, "utf8"),
      ) as PartStateSidecar;
    }
    const parts = fixtureToVesselSchematicParts(fixture, sidecar);
    const svg = renderVesselSchematicToSvg(parts, { width: 800, height: 800 });
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

function fixtureToVesselSchematicParts(
  fixture: Fixture,
  sidecar?: PartStateSidecar,
): VesselSchematicPart[] {
  const topo = fixture["v.topology"];
  const view = pickView(topo.parts);
  return topo.parts.map((p) => {
    const modules = sidecar?.[String(p.flightId)];
    const partState: PartState | undefined = modules
      ? { seq: 0, modules }
      : undefined;
    return buildVesselSchematicPart(p, undefined, undefined, view, partState);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
