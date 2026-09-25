#!/usr/bin/env node
/**
 * Delete what `tsc` emitted into `dist` for a source that no longer exists.
 *
 * `tsc` writes what its sources produce and never deletes anything, so a
 * removed or renamed source leaves its old output behind for good. Run this
 * AFTER `tsc`, never instead of cleaning before it: emptying `dist` first
 * leaves a window in which the package has no build at all, and a test that
 * executes its own `dist` (the sdk's CLI does) fails whenever a build overlaps
 * it or is killed partway.
 *
 * Only `tsc`'s own outputs are candidates (`.js`, `.d.ts` and their maps), so
 * anything a later build step writes into `dist` is never touched.
 *
 * Usage, from a package directory: node <repo>/scripts/prune-dist.mjs
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = "src";
const OUT = "dist";
const EMITTED = /\.(d\.ts|js)(\.map)?$/;
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}

if (existsSync(OUT)) {
  let pruned = 0;
  for (const path of files(OUT)) {
    if (!EMITTED.test(path)) continue;
    const stem = relative(OUT, path).replace(EMITTED, "");
    const hasSource = SOURCE_EXTENSIONS.some((ext) =>
      existsSync(join(SRC, stem + ext)),
    );
    if (!hasSource) {
      rmSync(path);
      pruned++;
    }
  }
  if (pruned > 0) console.log(`prune-dist: removed ${pruned} orphaned file(s)`);
}
