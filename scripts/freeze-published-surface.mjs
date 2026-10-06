#!/usr/bin/env node
/**
 * Freezes the published surface ledgers as part of a release, and sets the
 * versions the freeze prints.
 *
 * Two ledgers collect declared changes in a `pending` entry while their
 * `versionMoves` is `at-release`: `mod/sitrep-sdk/extension-api.ledger.json`
 * (sitrep-sdk and ui-kit, against `EXTENSION_API_VERSION`) and
 * `packages/uplink-tools/api-surface.ledger.json` (against that package's own
 * version). Nothing else moves either version, so the release flow does it here.
 *
 * Usage:
 *   freeze-published-surface.mjs --note <text> [--dry-run]
 *
 * `--dry-run` writes nothing and runs no test: it prints, per ledger, what the
 * freeze would record and the version it would set. Both modes fail when a
 * pending entry has an empty note, before anything is written.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const EXTENSION_API_FILE = "mod/sitrep-sdk/src/compat-versions.ts";
const VERSION_LINE =
  /^(export const EXTENSION_API_VERSION = ")(\d+\.\d+\.\d+)(";)$/m;

export const LEDGERS = [
  {
    id: "extension-api",
    file: "mod/sitrep-sdk/extension-api.ledger.json",
    currentVersion: (root) => readExtensionApiVersion(root),
    setVersion: (root, version) => setExtensionApiVersion(root, version),
    versionName: "EXTENSION_API_VERSION",
  },
  {
    id: "uplink-tools",
    file: "packages/uplink-tools/api-surface.ledger.json",
    currentVersion: (root) => readPackageVersion(root),
    setVersion: (root, version) => setPackageVersion(root, version),
    versionName: "@ksp-gonogo/uplink-tools version",
    /** The package whose own version this ledger moves at a freeze. */
    package: "@ksp-gonogo/uplink-tools",
  },
];

const UPLINK_TOOLS_MANIFEST = "packages/uplink-tools/package.json";

/** The version a change set moves a ledger to, by the ledger's own versioning rule. */
export function nextVersion(previous, hasBreaks, versioning) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(previous);
  if (!match) throw new Error(`${previous} is not a version`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (versioning === "semver") {
    return hasBreaks ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`;
  }
  return hasBreaks
    ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`;
}

/**
 * What freezing a ledger would do, from its text and the version the code
 * carries: the pending keys, any with an empty note, and the version it lands on.
 */
export function planFreeze(ledgerText, carriedVersion) {
  const ledger = JSON.parse(ledgerText);
  const { breaks, additions } = ledger.pending;
  const emptyNotes = [...breaks, ...additions]
    .filter((change) => change.note.trim() === "")
    .map((change) => change.key);
  const latest = ledger.entries[ledger.entries.length - 1].version;
  const pending = breaks.length + additions.length > 0;
  return {
    pending,
    breaks: breaks.map((change) => change.key),
    additions: additions.map((change) => change.key),
    emptyNotes,
    latest,
    carriedVersion,
    next: pending
      ? nextVersion(latest, breaks.length > 0, ledger.versioning)
      : null,
  };
}

/** Whether the move crosses a major, which the app refuses every Uplink build across. */
export function movesMajor(from, to) {
  return from.split(".")[0] !== to.split(".")[0];
}

export function replaceExtensionApiVersion(source, version) {
  if (!VERSION_LINE.test(source)) {
    throw new Error(`${EXTENSION_API_FILE} has no EXTENSION_API_VERSION line`);
  }
  return source.replace(VERSION_LINE, `$1${version}$3`);
}

export function replaceManifestVersion(manifestText, version) {
  const manifest = JSON.parse(manifestText);
  manifest.version = version;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function readExtensionApiVersion(root) {
  const match = VERSION_LINE.exec(
    readFileSync(join(root, EXTENSION_API_FILE), "utf8"),
  );
  if (!match)
    throw new Error(`${EXTENSION_API_FILE} has no EXTENSION_API_VERSION line`);
  return match[2];
}

function setExtensionApiVersion(root, version) {
  const path = join(root, EXTENSION_API_FILE);
  writeFileSync(
    path,
    replaceExtensionApiVersion(readFileSync(path, "utf8"), version),
  );
}

function readPackageVersion(root) {
  return JSON.parse(readFileSync(join(root, UPLINK_TOOLS_MANIFEST), "utf8"))
    .version;
}

function setPackageVersion(root, version) {
  const path = join(root, UPLINK_TOOLS_MANIFEST);
  writeFileSync(
    path,
    replaceManifestVersion(readFileSync(path, "utf8"), version),
  );
}

/**
 * Runs the lock's freeze for one ledger and returns the version it recorded.
 * The version is read back from the ledger's new latest entry, not from the
 * run's output: a passing vitest run does not show its console lines.
 */
function runFreeze(root, ledger, note) {
  execFileSync(
    "pnpm",
    [
      "--filter",
      "@ksp-gonogo/core",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.scans.config.ts",
      "src/styleguide-published-surface.test.ts",
      "-t",
      "the published surface utilities",
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        GONOGO_SURFACE_FREEZE: ledger.id,
        GONOGO_SURFACE_NOTE: note,
      },
    },
  );
  execFileSync("pnpm", ["exec", "biome", "check", "--write", ledger.file], {
    cwd: root,
    stdio: "inherit",
  });
  const { entries } = JSON.parse(readFileSync(join(root, ledger.file), "utf8"));
  return entries[entries.length - 1].version;
}

export function main(argv, root = REPO_ROOT) {
  const dryRun = argv.includes("--dry-run");
  const noteAt = argv.indexOf("--note");
  const note = noteAt === -1 ? "" : (argv[noteAt + 1] ?? "").trim();
  if (!note)
    throw new Error("--note <text> is required: it is the entry's note");

  const plans = LEDGERS.map((ledger) => ({
    ledger,
    plan: planFreeze(
      readFileSync(join(root, ledger.file), "utf8"),
      ledger.currentVersion(root),
    ),
  }));

  const empty = plans.flatMap(({ ledger, plan }) =>
    plan.emptyNotes.map((key) => `${ledger.id}: ${key}`),
  );
  if (empty.length > 0) {
    throw new Error(
      `pending changes with no note, write each in its ledger and land that first:\n${empty.join("\n")}`,
    );
  }

  const moved = [];
  for (const { ledger, plan } of plans) {
    if (plan.carriedVersion !== plan.latest) {
      throw new Error(
        `${ledger.id}: the code carries ${plan.carriedVersion} but the ledger's latest entry is ${plan.latest}`,
      );
    }
    if (!plan.pending) {
      console.info(
        `${ledger.id}: nothing pending, ${ledger.versionName} stays ${plan.latest}`,
      );
      continue;
    }
    console.info(
      [
        `${ledger.id}: ${plan.latest} -> ${plan.next}`,
        `  breaks (${plan.breaks.length}):`,
        ...plan.breaks.map((key) => `    ${key}`),
        `  additions (${plan.additions.length}):`,
        ...plan.additions.map((key) => `    ${key}`),
      ].join("\n"),
    );
    if (ledger.id === "extension-api" && movesMajor(plan.latest, plan.next)) {
      console.warn(
        `::warning::EXTENSION_API_VERSION moves to a new major (${plan.next}): the app refuses every gonogo-uplinks build until that repository re-pins`,
      );
    }
    if (dryRun) continue;
    const printed = runFreeze(root, ledger, note);
    if (printed !== plan.next) {
      throw new Error(
        `${ledger.id}: the freeze printed ${printed} where ${plan.next} was planned`,
      );
    }
    ledger.setVersion(root, printed);
    moved.push(ledger.id);
  }
  console.info(
    dryRun
      ? "dry run: nothing written"
      : `froze: ${moved.join(", ") || "none"}`,
  );
  return moved;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(
      `::error::${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
