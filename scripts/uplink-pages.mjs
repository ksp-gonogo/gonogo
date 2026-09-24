#!/usr/bin/env node
/**
 * Rewrite every bundled Uplink's generated PROSE, and touch no picture.
 *
 * ## The thing this exists to make cheap
 *
 * An Uplink's page carries a `| Built against | contract X.Y, api ..., ui-kit ... |`
 * row, and its `gonogo-uplink.json` carries the same pair as numbers. Both are
 * generated, both are gated by the Uplink's own suite, and both move on a
 * contract MINOR bump, which is additive by definition and breaks nothing.
 *
 * So the cheapest permitted change in the whole contract, adding a field, failed
 * a blocking test in every bundled Uplink at once, and the only remedy anyone
 * had was `gonogo-uplink docs`: a full Chromium render of every fixture, which
 * rewrites all 170 committed PNGs through the local rasteriser on the way past.
 * That is the same error as committing locally-rendered visual baselines, and it
 * was the sanctioned fix for a one-line markdown change.
 *
 * This is the other half. The prose comes off a registry read with no browser in
 * it (`checkUplinkPage` has always been able to compute it; `writeUplinkPage` now
 * writes it), so the heal is a few seconds, is byte-identical on any operating
 * system, and cannot reach `docs/assets` because it renders nothing.
 *
 * The pictures stay where they were: they are regenerated on Linux by
 * `uplink-docs.yml`, which is the only machine whose renders this repo commits.
 *
 * ## Why it runs each page through that Uplink's own vitest
 *
 * The registries are global, so a second client loaded beside the first is read
 * as a host of it and both pages come out describing the pair. One process per
 * Uplink is what keeps each page about one Uplink, which is the same reason the
 * check lives in the Uplink's suite rather than in a repo-wide walk here.
 *
 * There is no `--check` here. Every one of these tests already runs in `pnpm
 * test`, and asking the same question a second way is how two instruments end up
 * disagreeing about one fact.
 *
 * Usage:
 *   node scripts/uplink-pages.mjs
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The two generated files this writes, relative to a client directory. */
const PAGE_FILES = ["README.md", "gonogo-uplink.json"];

/**
 * The call that makes a test file the page's gate, matched the way
 * `uplink-docs-gate.mjs` matches it: by the CALL rather than by a filename. A
 * file named `uplink-page.test.ts` that asserts something else would pass a name
 * match while regenerating nothing, and this would report every page current.
 */
const PAGE_CHECK_CALL = "expectUplinkPageCurrent(";

/** Every `*.test.ts(x)` under `dir`, node_modules and dist aside. */
function testFiles(dir) {
  const found = [];
  const walk = (at) => {
    let entries;
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.test\.tsx?$/.test(entry.name)) found.push(full);
    }
  };
  walk(dir);
  return found;
}

/** The contents of a client's generated files, keyed by name, absent ones too. */
function pageContents(clientDir) {
  return PAGE_FILES.map((name) => {
    try {
      return [name, readFileSync(join(clientDir, name), "utf8")];
    } catch {
      return [name, undefined];
    }
  });
}

/**
 * Discovered from the same matrix CI iterates, never a list here. A run that
 * examines nothing exits clean, which is the failure this repo keeps meeting, so
 * an empty discovery is a broken discovery rather than an empty repo.
 */
const legs = JSON.parse(
  execFileSync("node", [join(ROOT, "scripts/uplink-matrix.mjs")], {
    encoding: "utf8",
  }),
).filter((leg) => leg.client);

if (legs.length === 0) {
  console.error(
    "✖ the matrix reported no Uplink with a client, so this regenerated nothing and would\n" +
      "  have exited clean. Discovery is broken rather than the repo being empty.",
  );
  process.exit(1);
}

const moved = [];
const failed = [];

for (const leg of legs) {
  const clientDir = join(ROOT, "mod", leg.id, "client");
  const tests = testFiles(clientDir).filter((file) =>
    readFileSync(file, "utf8").includes(PAGE_CHECK_CALL),
  );
  if (tests.length === 0) {
    console.error(`  ✖ ${leg.id}: no test calls expectUplinkPageCurrent()`);
    failed.push(leg.id);
    continue;
  }

  const before = pageContents(clientDir);
  try {
    execFileSync(
      "pnpm",
      [
        "--filter",
        leg.pkg,
        "exec",
        "vitest",
        "run",
        ...tests.map((file) => relative(clientDir, file)),
      ],
      {
        cwd: ROOT,
        stdio: "inherit",
        env: { ...process.env, GONOGO_UPLINK_PAGE_UPDATE: "1" },
      },
    );
  } catch {
    failed.push(leg.id);
  }

  // What actually changed on disk, rather than what the run said. Vitest's
  // default reporter swallows console output from a test that PASSES, and the
  // whole point of the update switch is that the test passes, so anything the
  // writer printed is invisible from here.
  const after = pageContents(clientDir);
  for (const [i, [name, content]] of after.entries()) {
    if (content !== before[i][1]) moved.push(`${leg.id}/client/${name}`);
  }
  console.log(`  ${leg.id}`);
}

if (moved.length > 0) {
  console.log(
    `\n${moved.length} generated file(s) rewritten:\n` +
      moved.map((file) => `    mod/${file}`).join("\n"),
  );
} else {
  console.log("\nevery page's prose already describes the code.");
}

if (failed.length > 0) {
  console.error(
    `\n✖ ${failed.length} of ${legs.length} Uplink page(s) could not be regenerated:\n` +
      failed.map((id) => `    ${id}`).join("\n") +
      "\n\n  The prose is browserless, so a failure here is the Uplink's own suite failing to\n" +
      "  load its client, not a missing render.",
  );
  process.exit(1);
}
