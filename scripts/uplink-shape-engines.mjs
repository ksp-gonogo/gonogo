#!/usr/bin/env node
/**
 * Is a shape actually the same on a machine that is not this one.
 *
 * The whole freshness check rests on one claim: the fields in
 * `ADMISSIBLE_PROPERTIES` are things the CSS cascade computes, so two machines
 * rendering the same code produce the same shape, while the fields it excludes
 * are things a glyph rasteriser measures and do not. If that claim is wrong the
 * gate is a random-number generator that goes red on other people's machines,
 * which is worse than the blindness it replaced.
 *
 * The claim cannot be settled by running twice here. So this renders a real
 * Uplink's real widgets in **chromium, firefox and webkit** and compares the
 * shapes. Three layout engines with three font stacks on one machine is a
 * STRICTLY HARDER test than one engine across two operating systems: an engine
 * difference includes every font-metric difference an OS could introduce and
 * adds its own box model on top.
 *
 * So agreement here is strong evidence of OS-independence. Disagreement is not
 * proof of the opposite, because engines also differ in ways operating systems
 * do not, and that asymmetry is the point of running it: it is cheap, it runs
 * anywhere, and it fails loud in the direction that matters.
 *
 * ## Reading a result, in one sentence
 *
 * **A plant that does not fire is either a broken instrument or a null change,
 * and those want opposite responses.** Two of the three historical plants used to
 * validate the freshness check were nulls: reverting `Row`/`Inline` to before the
 * badge-wrap fix changed nothing, because `wrap` defaults to false and emits
 * byte-identical CSS, and the only real DOM change in that commit was to
 * `ScienceExperimentRow`, which no Uplink renders. Both correctly stayed green.
 * Establish that the plant is a real change to something the render actually
 * contains before concluding anything about the instrument.
 *
 * ## What a disagreement means, and what NOT to do about it
 *
 * The first instinct on a red is to drop the field that differs. Do that only
 * after ruling out the other cause: **a widget whose JS branches on a measured
 * width** (a `ResizeObserver`, a measure-then-render pass) produces a different
 * DOM on a different font stack, so the shape inherits the OS-dependence through
 * the back door with every admissible field innocent. Then the widget is the
 * problem and the gate is telling the truth. `Panel`'s `sections` is deliberately
 * pure CSS auto-fit for exactly this reason, and the three widgets that had
 * hand-rolled an `isLandscape` boolean off `getWidgetShape` are where to look.
 *
 * ## Real widgets, because the first version of this was a synthetic page
 *
 * An earlier probe rendered hand-written markup exercising the same property
 * list, in the same three engines, and passed clean. The property list was fine;
 * its colours were hex and so never resolved through a wide-gamut `color()`, which
 * is where the only real disagreement lived. **It graded the rule, not the thing
 * the rule gets applied to.**
 *
 * So this renders an Uplink's real registrations, and it is a committed script
 * rather than a scratch file, because a measurement nobody can re-run is an
 * assertion. `renderUplink` is called directly rather than through the `docs` verb
 * so nothing is written into the Uplink, only into a scratch directory.
 *
 *   node scripts/uplink-shape-engines.mjs [<mod dir name>]
 *
 * Defaults to a small Uplink. Needs a built kit and all three browsers:
 *   pnpm --filter '@ksp-gonogo/ui-kit...' build
 *   pnpm exec playwright install --with-deps chromium firefox webkit
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderUplink,
  resolveUplinkPackage,
} from "../packages/ui-kit/dist/render.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINES = ["chromium", "firefox", "webkit"];
const target = process.argv[2] ?? "GonogoRealAntennasUplink";

const pkg = resolveUplinkPackage(join(ROOT, "mod", target, "client"), {});
console.log(`${pkg.name}\n`);

const byEngine = new Map();
const dirOf = new Map();
for (const engine of ENGINES) {
  const outDir = mkdtempSync(join(tmpdir(), `uplink-shape-${engine}-`));
  const result = await renderUplink(pkg, {
    engine,
    outDir,
    frames: false,
    // So a disagreement can name the PROPERTY rather than the hash. A harness
    // that can only say "these differ" hands the reader the same question it
    // was given.
    dumpShapes: true,
  });
  byEngine.set(engine, new Map(result.assets.map((a) => [a.file, a.shape])));
  dirOf.set(engine, outDir);
  console.log(`  ${engine}: ${result.assets.length} render(s)`);
}

/** The first few lines on which two engines' raw shape text differs. */
function firstDifferences(file, a, b, limit = 3) {
  const read = (engine) => {
    try {
      return readFileSync(
        join(dirOf.get(engine), `${file}.shape.txt`),
        "utf8",
      ).split("\n");
    } catch {
      return [];
    }
  };
  const left = read(a);
  const right = read(b);
  const rows = [];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === right[i]) continue;
    rows.push({ line: i + 1, a: left[i] ?? "(end)", b: right[i] ?? "(end)" });
    if (rows.length === limit) break;
  }
  return rows;
}

const [base, ...others] = ENGINES;
const baseShapes = byEngine.get(base);
const disagreements = [];

for (const file of [...baseShapes.keys()].sort()) {
  for (const engine of others) {
    const mine = byEngine.get(engine).get(file);
    const theirs = baseShapes.get(file);
    if (mine === undefined) {
      disagreements.push(`${file}: ${engine} rendered no such asset`);
      continue;
    }
    if (mine.hash === theirs.hash) continue;
    const why = [];
    if (mine.elements !== theirs.elements) {
      why.push(
        `${base} saw ${theirs.elements} elements, ${engine} saw ${mine.elements}`,
      );
    }
    if (mine.text !== theirs.text) why.push("the visible text differs");
    if (why.length === 0) why.push("a computed style differs");
    disagreements.push({
      headline: `${file}: ${base} ${theirs.hash} vs ${engine} ${mine.hash} (${why.join("; ")})`,
      detail: firstDifferences(file, base, engine),
      base,
      engine,
    });
  }
}

// A run that compared nothing exits clean, which is the failure mode this repo
// keeps meeting.
if (baseShapes.size === 0) {
  console.error(
    `\n✖ ${target} produced no renders, so this compared nothing and would ` +
      "have exited clean.",
  );
  process.exit(1);
}

if (disagreements.length > 0) {
  console.error(
    `\n✖ ${disagreements.length} shape(s) differ between engines, so a shape is ` +
      "NOT a machine-independent fact and the freshness gate cannot be trusted:",
  );
  for (const row of disagreements) {
    console.error(`\n    ${row.headline}`);
    for (const d of row.detail) {
      console.error(`      line ${d.line}`);
      console.error(`        ${row.base}: ${d.a}`);
      console.error(`        ${row.engine}: ${d.b}`);
    }
  }
  console.error(
    "\n  Before removing a field from ADMISSIBLE_PROPERTIES, check whether a " +
      "widget in this render branches on a MEASURED width. If it does, the " +
      "shape differs because the DOM differs, every field is innocent, and the " +
      "widget is what wants fixing.",
  );
  process.exit(1);
}

console.log(
  `\n${baseShapes.size} asset(s), identical shapes in ${ENGINES.join(", ")}.`,
);
