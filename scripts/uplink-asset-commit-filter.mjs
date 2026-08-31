#!/usr/bin/env node
/**
 * Decide, per changed docs asset, whether the change is a repair or churn.
 *
 * `uplink-docs.yml` regenerates every Uplink page on a push and commits the
 * result back. Its commit-back used to stage additions and deletions and run
 * `git checkout --` over everything else, so **a modified asset was discarded and
 * the self-heal had never once healed a stale picture, on any branch.**
 *
 * The reasoning behind that rule was not wrong, it was correct on the evidence
 * that had been gathered and untested on the case it governs:
 *
 *   "A PNG re-renders byte-identically on the same runner, but a motion scene's
 *    GIF does NOT: measured on jogwheel-rate-mode--default.gif, three
 *    regenerations in a row produced three different files from an unchanged
 *    tree."
 *
 * Both halves of that are true. The trap is "from an unchanged tree": byte
 * stability holds exactly in the case where discarding costs nothing, and the
 * case the workflow exists FOR is the tree that DID change, where the same rule
 * throws away the only signal it was built to publish. Staging byte changes
 * unconditionally really would push a churn GIF on every run forever; the rule
 * simply had no way to tell that from a repair.
 *
 * The shape is that predicate. `docs/assets/render-shape.json`, written by
 * `gonogo-uplink docs` beside the assets, records what each asset's render IS in
 * terms that are the same on any machine (see
 * `packages/ui-kit/src/render/shape.ts`). So:
 *
 *   - added or deleted        keep, exactly as before
 *   - shape changed           keep, the picture is genuinely different
 *   - shape identical         discard, the bytes moved and the render did not
 *   - no shape recorded yet   keep, and this run records it
 *
 * The last arm is a one-off per Uplink. `gonogo-uplink docs` writes the record on
 * every run, so an Uplink is unrecorded only until the first regeneration after
 * this landed, and on that run a modified asset is far likelier to be the
 * backlog of real staleness than churn.
 *
 * Usage, from the repo root, after `pnpm uplink-docs` has run:
 *
 *   node scripts/uplink-asset-commit-filter.mjs            stage and revert
 *   node scripts/uplink-asset-commit-filter.mjs --dry-run   say what it would do
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DRY = process.argv.includes("--dry-run");
const ASSET_GLOB = "mod/*/client/docs/assets/*";
const RECORD = "render-shape.json";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/**
 * The committed side of a record, read from git rather than from disk.
 *
 * `gonogo-uplink docs` has already overwritten the working copy by the time this
 * runs, so disk holds the NEW record and the only place the old one survives is
 * the index's parent commit.
 */
function committedRecord(path) {
  try {
    return JSON.parse(
      execFileSync("git", ["show", `HEAD:${path}`], {
        encoding: "utf8",
        // An Uplink with no record yet is the normal first case, and git's
        // "exists on disk, but not in HEAD" on stderr would read as a failure.
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return undefined;
  }
}

function localRecord(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

const shapeOf = (record, file) => record?.assets?.[file]?.hash;

/**
 * `git status --porcelain` over the assets, as `[code, path]` pairs.
 *
 * The pathspec ends `/*` and that is load-bearing, for the reason the workflow
 * recorded before this script existed: a git pathspec containing a wildcard is
 * matched as a PATTERN against whole paths rather than resolved as a directory
 * prefix, so `mod/*\/client/docs/assets` matches the directory and none of the
 * files under it, and reported zero changes against a tree with a modified GIF
 * in it.
 */
function changedAssets() {
  const out = git("status", "--porcelain", "--", ASSET_GLOB);
  const rows = [];
  for (const line of out.split("\n")) {
    if (line.trim().length === 0) continue;
    const code = line.slice(0, 2).trim();
    const path = line.slice(3).trim();
    rows.push([code, path]);
  }
  return rows;
}

const keep = [];
const discard = [];
const records = new Map();

for (const [code, path] of changedAssets()) {
  const base = path.slice(path.lastIndexOf("/") + 1);

  // The record itself is not an asset and is never a candidate for discarding:
  // it is derived from the shapes, so it differs only when a shape differs.
  if (base === RECORD) {
    keep.push([path, "the shape record itself"]);
    continue;
  }

  if (code === "??" || code === "D") {
    keep.push([path, code === "??" ? "a new asset" : "a deleted asset"]);
    continue;
  }

  const recordPath = join(dirname(path), RECORD);
  if (!records.has(recordPath)) {
    records.set(recordPath, {
      was: committedRecord(recordPath),
      now: localRecord(recordPath),
    });
  }
  const { was, now } = records.get(recordPath);
  const before = shapeOf(was, base);
  const after = shapeOf(now, base);

  if (before === undefined) {
    keep.push([path, "no shape was recorded for it before this run"]);
  } else if (after === undefined) {
    // The render produced no shape for a file that is nonetheless on disk. Keep
    // it and say so rather than deciding quietly: something did not run.
    keep.push([path, "THIS RUN recorded no shape for it, which is a bug"]);
  } else if (before !== after) {
    keep.push([path, `shape ${before} became ${after}`]);
  } else {
    discard.push([path, `shape ${before} unchanged, only the bytes moved`]);
  }
}

for (const [path, why] of keep) {
  console.log(`keep     ${path}  (${why})`);
  if (!DRY) git("add", "-A", "--", path);
}
for (const [path, why] of discard) {
  console.log(`discard  ${path}  (${why})`);
  if (!DRY) git("checkout", "--", path);
}

console.log(
  `\n${keep.length} asset change(s) kept, ${discard.length} discarded as churn.`,
);
if (DRY) console.log("(--dry-run: nothing was staged or reverted)");
