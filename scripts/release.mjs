#!/usr/bin/env node
// Bump the lockstep version, commit, and tag. Does NOT push — review the
// commit + tag locally, then push manually:
//
//   git push origin main v0.1.0
//
// The release workflow is `workflow_dispatch` only (manual trigger from
// the Actions UI on the new tag), so pushing a tag by itself doesn't
// publish anything.
//
// Usage:
//   node scripts/release.mjs patch
//   node scripts/release.mjs minor
//   node scripts/release.mjs major
//   node scripts/release.mjs 1.2.3   # explicit version

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const appPkgPath = resolve(repoRoot, "packages/app/package.json");

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    stdio: "inherit",
    cwd: repoRoot,
    ...opts,
  });
}

function captureStatus() {
  const out = execFileSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  return out.trim();
}

function nextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) {
    console.error(`current version "${current}" is not M.m.p`);
    process.exit(1);
  }
  let [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === "patch") pat++;
  else if (bump === "minor") {
    min++;
    pat = 0;
  } else if (bump === "major") {
    maj++;
    min = 0;
    pat = 0;
  } else {
    console.error(`Usage: release.mjs <patch|minor|major|M.m.p>`);
    process.exit(1);
  }
  return `${maj}.${min}.${pat}`;
}

const bump = process.argv[2];
if (!bump) {
  console.error(`Usage: release.mjs <patch|minor|major|M.m.p>`);
  process.exit(1);
}

const dirty = captureStatus();
if (dirty.length > 0) {
  console.error("working tree is dirty — commit or stash first:");
  console.error(dirty);
  process.exit(1);
}

const current = JSON.parse(readFileSync(appPkgPath, "utf-8")).version;
const next = nextVersion(current, bump);
const tag = `v${next}`;

console.log(`releasing v${current} -> v${next}`);

run("node", [resolve(here, "set-version.mjs"), next]);
run("git", ["add", "packages/*/package.json"]);
run("git", ["commit", "-m", `chore: ${tag}`]);
run("git", ["tag", "-a", tag, "-m", `gonogo ${tag}`]);

console.log("");
console.log(`done. created commit + tag locally:`);
console.log(`  ${tag}`);
console.log("");
console.log("review the commit, then push when ready:");
console.log(`  git push origin main ${tag}`);
console.log("");
console.log(
  `then trigger the release workflow manually from the Actions UI` +
    ` (pick the ${tag} tag in the "Run workflow" dropdown).`,
);
