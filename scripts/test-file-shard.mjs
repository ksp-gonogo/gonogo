/**
 * Deals a package's test files across CI shards by how long they take.
 *
 * Vitest's own `--shard` splits by a hash of the path, so a package whose time is
 * concentrated in a few files lands those files together: the components axe
 * files alone are a third of that suite, and one hash shard took three times as
 * long as another. Files are dealt heaviest first to the lightest shard, from
 * the seconds in test-file-shard-weights.json and a flat weight for any file it
 * does not name, so the split is deterministic and a stale file costs balance
 * only, never coverage: every listed file lands in exactly one shard.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEIGHTS = join(ROOT, "scripts", "test-file-shard-weights.json");

export const SECONDS_PER_UNMEASURED_FILE = 1;

/** Every test file vitest would run in `dir`, as absolute paths. */
export function listTestFiles(dir) {
  const run = spawnSync(
    "pnpm",
    ["exec", "vitest", "list", "--filesOnly", "--json"],
    { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0)
    throw new Error(`vitest list failed in ${dir}:\n${run.stderr}`);
  return JSON.parse(run.stdout).map((entry) => entry.file);
}

/**
 * One file list per shard. `weights` maps a repo-relative path to seconds.
 * Ties break on the path so two runs of one tree agree.
 */
export function partitionFiles(files, weights, shards) {
  const bins = Array.from({ length: shards }, () => ({ load: 0, files: [] }));
  const weighted = files.map((file) => [
    file,
    weights[relative(ROOT, file)] ?? SECONDS_PER_UNMEASURED_FILE,
  ]);
  weighted.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  for (const [file, weight] of weighted) {
    const bin = bins.reduce((lo, b) => (b.load < lo.load ? b : lo));
    bin.load += weight;
    bin.files.push(file);
  }
  return bins.map((b) => b.files.sort());
}

export function measuredWeights() {
  return JSON.parse(readFileSync(WEIGHTS, "utf8"));
}

/** The files shard `index` of `count` (1-based) runs, in `dir`. */
export function filesForShard(dir, index, count) {
  return partitionFiles(listTestFiles(dir), measuredWeights(), count)[
    index - 1
  ];
}
