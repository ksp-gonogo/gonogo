#!/usr/bin/env tsx
/**
 * Render every Navball fixture under `src/Navball/__fixtures__/` to an
 * SVG file in `local_docs/renders/navball/`. Used for visually iterating
 * on the attitude dial without running KSP / the dashboard.
 *
 * Run with `pnpm --filter @gonogo/components render-navball`.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderAttitudeDialToSvg } from "../src/Navball/render";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(HERE, "../src/Navball/__fixtures__");
const OUT_DIR = resolve(HERE, "../../../local_docs/renders/navball");
const ARTIFACT_EXTS = new Set([".svg"]);

interface Fixture {
  "n.heading": number;
  "n.pitch": number;
  "n.roll": number;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await cleanArtifacts(OUT_DIR, ARTIFACT_EXTS);
  const entries = await readdir(FIXTURES_DIR);
  const fixtures = entries.filter((e) => e.endsWith(".json"));
  if (fixtures.length === 0) {
    console.error(`No fixtures found in ${FIXTURES_DIR}`);
    process.exit(1);
  }

  for (const name of fixtures) {
    const raw = await readFile(join(FIXTURES_DIR, name), "utf8");
    const fixture = JSON.parse(raw) as Fixture;
    const svg = renderAttitudeDialToSvg({
      heading: fixture["n.heading"],
      pitch: fixture["n.pitch"],
      roll: fixture["n.roll"],
      size: 320,
    });
    const outName = name.replace(/\.json$/, ".svg");
    const outPath = join(OUT_DIR, outName);
    await writeFile(outPath, svg, "utf8");
    console.log(
      `  ${outName.padEnd(36)} h=${String(fixture["n.heading"]).padStart(4)}° ` +
        `p=${String(fixture["n.pitch"]).padStart(4)}° ` +
        `r=${String(fixture["n.roll"]).padStart(4)}°`,
    );
  }

  console.log(`\nRendered ${fixtures.length} fixtures → ${OUT_DIR}`);
}

/**
 * Wipe stale artifacts from the output dir before regenerating. Only
 * touches top-level files whose extension is in the allowlist so a stray
 * sibling directory (a sandbox someone made for one-off experiments) is
 * never recursively destroyed.
 */
async function cleanArtifacts(
  dir: string,
  allow: ReadonlySet<string>,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const dot = entry.name.lastIndexOf(".");
    if (dot < 0) continue;
    const ext = entry.name.slice(dot).toLowerCase();
    if (!allow.has(ext)) continue;
    await rm(join(dir, entry.name));
    removed++;
  }
  if (removed > 0) {
    console.log(`Cleaned ${removed} stale artifact(s) from ${dir}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
