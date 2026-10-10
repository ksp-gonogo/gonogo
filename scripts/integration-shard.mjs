#!/usr/bin/env node
/**
 * Splits Sitrep.Host.IntegrationTests across parallel CI jobs by test class.
 *
 *   integration-shard.mjs filter <i>/<n>   print the `dotnet test --filter` for shard i
 *   integration-shard.mjs verify <n>       fail unless every discovered test lands in exactly one shard
 *
 * The suite stays serial inside each job (see TestParallelization.cs); only
 * the jobs run side by side. Classes are read from source and dealt out
 * heaviest first (by seconds) to the lightest shard, so the split is
 * deterministic and needs no build. `verify` lists the compiled tests and
 * matches each against the shards' class boundaries, which is what catches a
 * class the source scan missed: such a test would otherwise run in no shard.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = join(ROOT, "mod", "Sitrep.Host.IntegrationTests");
const NAMESPACE = "Sitrep.Host.IntegrationTests";
const WEIGHTS = join(ROOT, "scripts", "integration-shard-weights.json");
const TEST_ATTRIBUTE = /\[(Fact|Theory|RecordingFact)\b/g;

const SECONDS_PER_UNMEASURED_TEST = 1.7;

/**
 * Seconds per top-level class: measured in scripts/integration-shard-weights.json,
 * and an estimate from the test count for a class the file does not name yet.
 * A stale file costs balance only; coverage is `verify`'s job.
 */
export function classWeights(
  dir = PROJECT,
  measured = JSON.parse(readFileSync(WEIGHTS, "utf8")),
) {
  const weights = new Map();
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".cs"))
    .sort()) {
    const text = readFileSync(join(dir, file), "utf8");
    const count = (text.match(TEST_ATTRIBUTE) ?? []).length;
    if (count === 0) continue;
    const classes = [
      ...text.matchAll(
        /^ {4}(?:public |internal )?(?:sealed |static |abstract |partial )*class (\w+)/gm,
      ),
    ].map((m) => m[1]);
    if (classes.length === 0)
      throw new Error(
        `${file} has tests and no top-level class the scan can read`,
      );
    for (const c of classes)
      weights.set(
        c,
        measured[c] ??
          (weights.get(c) ?? 0) +
            (count / classes.length) * SECONDS_PER_UNMEASURED_TEST,
      );
  }
  return weights;
}

/** Deals classes heaviest first to the lightest shard. Returns one class list per shard. */
export function partition(weights, shards) {
  const bins = Array.from({ length: shards }, () => ({ load: 0, classes: [] }));
  const ordered = [...weights].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
  );
  for (const [name, weight] of ordered) {
    const bin = bins.reduce((lo, b) => (b.load < lo.load ? b : lo));
    bin.load += weight;
    bin.classes.push(name);
  }
  return bins.map((b) => b.classes.sort());
}

export function filterFor(classes) {
  return classes
    .flatMap((c) => [
      `FullyQualifiedName~${NAMESPACE}.${c}.`,
      `FullyQualifiedName~${NAMESPACE}.${c}+`,
    ])
    .join("|");
}

/** Shard indexes (0-based) whose class boundaries claim a listed test name. */
export function claimants(testName, shardClasses) {
  const hits = [];
  shardClasses.forEach((classes, i) => {
    if (
      classes.some(
        (c) =>
          testName.startsWith(`${NAMESPACE}.${c}.`) ||
          testName.startsWith(`${NAMESPACE}.${c}+`),
      )
    )
      hits.push(i);
  });
  return hits;
}

function listedTests() {
  const out = execFileSync(
    "dotnet",
    [
      "test",
      join(PROJECT, "Sitrep.Host.IntegrationTests.csproj"),
      "--configuration",
      "Release",
      "--list-tests",
      "--nologo",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const lines = out.split("\n");
  const start = lines.findIndex((l) =>
    l.includes("The following Tests are available"),
  );
  if (start < 0)
    throw new Error("dotnet test --list-tests printed no test list");
  return lines
    .slice(start + 1)
    .map((l) => l.trim())
    .filter(Boolean);
}

function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "filter") {
    const [i, n] = String(arg).split("/").map(Number);
    if (!(i >= 1 && i <= n))
      throw new Error(`shard must be i/n with 1 <= i <= n, got ${arg}`);
    process.stdout.write(`${filterFor(partition(classWeights(), n)[i - 1])}\n`);
    return;
  }
  if (cmd === "verify") {
    const shards = partition(classWeights(), Number(arg));
    const tests = listedTests();
    if (tests.length === 0)
      throw new Error(
        "the project lists no tests, so there is nothing to check coverage against",
      );
    const bad = [];
    for (const t of tests) {
      const hits = claimants(t, shards);
      if (hits.length !== 1)
        bad.push(
          `${t} -> ${hits.length === 0 ? "no shard" : `shards ${hits.map((h) => h + 1).join(", ")}`}`,
        );
    }
    if (bad.length > 0) {
      console.error(
        `${bad.length} of ${tests.length} tests are not in exactly one shard:\n${bad.slice(0, 20).join("\n")}`,
      );
      process.exit(1);
    }
    console.log(
      `all ${tests.length} tests are in exactly one of ${arg} shards`,
    );
    return;
  }
  throw new Error("usage: integration-shard.mjs filter <i>/<n> | verify <n>");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
