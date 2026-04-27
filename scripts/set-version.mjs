#!/usr/bin/env node
// Sets every workspace package.json under packages/* to a single version.
// Usage: node scripts/set-version.mjs <version>
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const packagesDir = resolve(repoRoot, "packages");

const next = process.argv[2];
if (!next || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(next)) {
  console.error("Usage: set-version.mjs <semver>");
  process.exit(1);
}

const dirs = readdirSync(packagesDir).filter((name) =>
  statSync(join(packagesDir, name)).isDirectory(),
);

let changed = 0;
for (const name of dirs) {
  const path = join(packagesDir, name, "package.json");
  let raw;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    continue;
  }
  const pkg = JSON.parse(raw);
  if (pkg.version === next) continue;
  pkg.version = next;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`updated ${name} -> ${next}`);
  changed++;
}

console.log(`done — ${changed} package.json files updated`);
