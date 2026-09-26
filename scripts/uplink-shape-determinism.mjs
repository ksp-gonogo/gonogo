#!/usr/bin/env node
/**
 * Does the same source hash the same way twice, and does a real change still
 * show.
 *
 * `uplink-shape-engines.mjs` asks whether a shape is the same on another
 * MACHINE. This asks the question underneath it, which went unasked and was the
 * one that was false: whether a shape is the same on the SAME machine, from the
 * same bytes, twice.
 *
 * It was not. Seventeen of one Uplink's 105 assets hashed differently between
 * two runs of an unchanged tree, and the hashes rotated rather than flipping
 * between two values, so `docs --check` reported a wall of staleness that had
 * nothing to do with anything anybody had edited. Every one of them was a
 * control the scene had pressed: `locator.click()` parks the pointer on the
 * button, `Button` transitions `color` and `border-color` over 120ms on
 * `:hover`, and the shape read was the one capture in the run taken while that
 * was still running. The picture beside it was never affected, because
 * `shoot` passes playwright's `animations: "disabled"`. See `settleAnimations`
 * in `packages/ui-kit/src/render/shape.ts`.
 *
 * ## Two legs, and the second one is why this is not just a repeat count
 *
 * A determinism fix has an obvious degenerate solution: hash less, until
 * nothing moves. That trades a noisy instrument for a silent one, which is
 * strictly worse, because a silent one is trusted. So this also PLANTS a
 * genuine change to what the page renders (a stylesheet that recolours every
 * button) and requires the shape to catch it. A run where the plant does not
 * fire fails as loudly as a run where the two clean renders disagree.
 *
 * ## What gates this day to day, which is not this script
 *
 * The render itself does: `captureShape` settles the tree, reads it twice and
 * refuses to return a reading that changed between the two. That runs on every
 * asset of every render, so a future animation that reintroduces a stopwatch
 * fails at generation time with the line named. This script is the measurement
 * behind that rule, kept runnable, in the same spirit as the engines probe.
 *
 *   node scripts/uplink-shape-determinism.mjs [<mod dir name>] [<engine>]
 *
 * Needs a built kit and the engine's browser:
 *   pnpm --filter '@ksp-gonogo/ui-kit...' build
 *   pnpm exec playwright install --with-deps chromium
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderUplink,
  resolveUplinkPackage,
} from "../packages/ui-kit/dist/render.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ?? "GonogoBreakingGroundUplink";
const engine = process.argv[3] ?? "chromium";

const pkg = resolveUplinkPackage(join(ROOT, "mod", target, "client"), {});
console.log(`${pkg.name} / ${engine}\n`);

/**
 * A stylesheet, loaded as an extra host module, that recolours every button.
 *
 * Chosen because it moves the STYLE half of the shape and nothing else: the
 * tree and the visible text are untouched, so a shape that catches it is
 * catching the half that broke rather than falling back on an element count.
 * Written at module scope, which is before any widget mounts, so it is the
 * button's starting colour and never a transition of its own.
 */
function plantModule() {
  const dir = mkdtempSync(join(tmpdir(), "uplink-shape-plant-"));
  const file = join(dir, "plant.js");
  writeFileSync(
    file,
    "const style = document.createElement('style');\n" +
      "style.textContent = 'button { color: rgb(1, 2, 3) !important; }';\n" +
      "document.head.append(style);\n",
  );
  return file;
}

async function shapesOf(label, withModules = []) {
  const outDir = mkdtempSync(join(tmpdir(), `uplink-shape-${label}-`));
  const result = await renderUplink(pkg, {
    engine,
    outDir,
    frames: false,
    withModules,
  });
  console.log(`  ${label}: ${result.assets.length} render(s)`);
  return new Map(result.assets.map((a) => [a.file, a.shape]));
}

const first = await shapesOf("run-1");
const second = await shapesOf("run-2");
const planted = await shapesOf("planted", [plantModule()]);

if (first.size === 0) {
  console.error(
    `\n✖ ${target} produced no renders, so this compared nothing and would ` +
      "have exited clean.",
  );
  process.exit(1);
}

const drifted = [];
for (const [file, shape] of first) {
  const again = second.get(file);
  if (again === undefined) {
    drifted.push(`${file}: the second run produced no such asset`);
  } else if (again.hash !== shape.hash) {
    drifted.push(`${file}: ${shape.hash} then ${again.hash}`);
  }
}

const caught = [...first].filter(
  ([file, shape]) => planted.get(file)?.hash !== shape.hash,
).length;

if (drifted.length > 0) {
  console.error(
    `\n✖ ${drifted.length} of ${first.size} shape(s) changed between two runs of ` +
      "the SAME source, so the hash is not a function of the code and cannot\n" +
      "  tell a stale page from noise:",
  );
  for (const row of drifted) console.error(`    ${row}`);
  process.exit(1);
}

if (caught === 0) {
  console.error(
    `\n✖ ${first.size} shape(s) are stable, and recolouring every button in the ` +
      "page changed NONE of them. A shape that cannot see a real change is a\n" +
      "  constant, and a constant passes every freshness check forever. The\n" +
      "  determinism result above means nothing until this fires.",
  );
  process.exit(1);
}

console.log(
  `\n${first.size} asset(s), identical shapes across two runs in ${engine}; ` +
    `a planted restyle moved ${caught} of them.`,
);
