#!/usr/bin/env node
/**
 * How many committed docs assets nothing can verify, and is it growing.
 *
 * `docs --check` can say whether an asset's picture is a picture of today's code
 * only if a shape was recorded for it (see
 * `packages/ui-kit/src/render/shape.ts`). An asset with no entry in its Uplink's
 * `docs/assets/render-shape.json` is invisible to that check, and this is the
 * count of those, held against `uplink-shape-debt.mjs` and allowed only to
 * shrink.
 *
 * It renders NOTHING and needs no browser: whether a file has an entry in a JSON
 * file beside it is a filesystem question, and a gate that needed ten chromium
 * renders to answer it is a gate nobody runs before pushing.
 *
 *   pnpm uplink-shape-gate            check
 *   pnpm uplink-shape-gate --update   rewrite the debt file from this run
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UNRECORDED_DEBT } from "./uplink-shape-debt.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UPDATE = process.argv.includes("--update");
const ASSET_RE = /\.(png|gif)$/;

/** Assets with no recorded shape, for one Uplink client directory. */
function unrecorded(assetDir) {
  if (!existsSync(assetDir)) return [];
  const assets = readdirSync(assetDir).filter((f) => ASSET_RE.test(f));
  const recordFile = join(assetDir, "render-shape.json");
  let recorded = {};
  if (existsSync(recordFile)) {
    try {
      recorded = JSON.parse(readFileSync(recordFile, "utf8")).assets ?? {};
    } catch (err) {
      throw new Error(`${recordFile} is unreadable: ${err.message}`);
    }
  }
  return assets.filter((f) => recorded[f] === undefined).sort();
}

function clients() {
  const legs = JSON.parse(
    execFileSync("node", [join(ROOT, "scripts/uplink-matrix.mjs")], {
      encoding: "utf8",
    }),
  );
  return legs.filter((leg) => leg.client);
}

/**
 * Prove the counter can see one before trusting a zero.
 *
 * A counter that cannot see a violation reports zero, and zero reads as success.
 * This repo has shipped three instruments that passed their own fixtures while
 * blind to production, so the gate plants an unrecorded asset in a scratch
 * directory and fails as BLIND if it counts none.
 */
function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "uplink-shape-gate-"));
  writeFileSync(join(dir, "planted--default.png"), "not really a png");
  writeFileSync(
    join(dir, "render-shape.json"),
    JSON.stringify({ version: 1, engine: "chromium", assets: {} }),
  );
  const seen = unrecorded(dir);
  if (seen.length !== 1 || seen[0] !== "planted--default.png") {
    console.error(
      "✖ BLIND: the gate planted one unrecorded asset and counted " +
        `${seen.length}. Every zero it reports below would be meaningless, so ` +
        "it refuses to report them.",
    );
    process.exit(1);
  }
  // And the other direction: a recorded asset must NOT be counted, or the gate
  // is a file counter that would report the whole tree as debt forever.
  writeFileSync(
    join(dir, "render-shape.json"),
    JSON.stringify({
      version: 1,
      engine: "chromium",
      assets: { "planted--default.png": { hash: "0", elements: 1, text: "0" } },
    }),
  );
  if (unrecorded(dir).length !== 0) {
    console.error(
      "✖ BLIND: the gate counted a RECORDED asset as unrecorded, so its " +
        "numbers are file counts rather than debt.",
    );
    process.exit(1);
  }
}

selfTest();

const legs = clients();
if (legs.length === 0) {
  console.error(
    "✖ discovered no client-bearing Uplink, so this examined nothing and would " +
      "have exited clean. Discovery is broken rather than the repo being empty.",
  );
  process.exit(1);
}

const measured = {};
const failures = [];
const drops = [];

for (const leg of legs) {
  // `leg.client` is a boolean; the directory is derived from the Uplink's `id`,
  // which is its `mod/` folder name.
  const assetDir = join(ROOT, "mod", leg.id, "client/docs/assets");
  const missing = unrecorded(assetDir);
  const allowed = UNRECORDED_DEBT[leg.pkg] ?? 0;
  if (missing.length > 0) measured[leg.pkg] = missing.length;
  const label = `${leg.pkg}: ${missing.length} unverifiable (allowed ${allowed})`;
  if (missing.length > allowed) {
    failures.push({ leg, missing, allowed });
    console.log(`  ✖ ${label}`);
  } else if (missing.length < allowed) {
    drops.push({ leg, count: missing.length, allowed });
    console.log(`  ↓ ${label}`);
  } else {
    console.log(`  · ${label}`);
  }
}

if (UPDATE) {
  const file = join(ROOT, "scripts/uplink-shape-debt.mjs");
  const source = readFileSync(file, "utf8");
  const body = Object.keys(measured)
    .sort()
    .map((pkg) => `  "${pkg}": ${measured[pkg]},`)
    .join("\n");
  const rewritten = source.replace(
    /export const UNRECORDED_DEBT = \{[\s\S]*?\n\};/,
    `export const UNRECORDED_DEBT = {\n${body}\n};`,
  );
  writeFileSync(file, rewritten, "utf8");
  console.log(`\nrewrote ${file} from this run.`);
  process.exit(0);
}

if (failures.length > 0) {
  console.log(
    `\n✖ ${failures.length} Uplink(s) carry MORE unverifiable assets than the ` +
      "debt file allows. An asset with no recorded shape is a picture nothing " +
      "can compare against the code that draws it.",
  );
  for (const { leg, missing, allowed } of failures) {
    console.log(
      `\n  ${leg.pkg} (allowed ${allowed}, found ${missing.length}):`,
    );
    for (const file of missing.slice(0, 8)) console.log(`    ${file}`);
    if (missing.length > 8) {
      console.log(`    … and ${missing.length - 8} more`);
    }
  }
  console.log(
    "\n  Record them by regenerating the page, which writes the shapes beside " +
      "the images:\n    pnpm uplink-docs\n" +
      "  On CI, `uplink-docs.yml` does it and commits the result. Renders belong " +
      "to Linux, so prefer the workflow over a local run for anything committed:\n" +
      "    gh workflow run uplink-docs.yml --ref <branch>",
  );
  process.exit(1);
}

const total = Object.values(measured).reduce((a, b) => a + b, 0);
if (drops.length > 0) {
  console.log(
    `\n${drops.length} Uplink(s) came in UNDER their entry. That is reported ` +
      "and not failed; tighten it deliberately with `pnpm uplink-shape-gate " +
      "--update` in the same commit as whatever recorded them.",
  );
}
console.log(
  `\n${total} committed asset(s) still carry no recorded shape, none above its ` +
    "allowance.",
);
