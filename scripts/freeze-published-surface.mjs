#!/usr/bin/env node
/**
 * Freezes the published surface ledgers as part of a release, and moves every
 * version the release carries.
 *
 * Two ledgers collect declared changes in a `pending` entry while their
 * `versionMoves` is `at-release`: `mod/sitrep-sdk/extension-api.ledger.json`
 * (sitrep-sdk and ui-kit, against `EXTENSION_API_VERSION`, which moves by its
 * own rule) and `packages/uplink-tools/api-surface.ledger.json` (whose entries
 * are recorded under the release that froze them). Then the app and every
 * published package move to the release version, pending or not: every package
 * carries one version, so a release moves them all.
 *
 * Usage:
 *   freeze-published-surface.mjs --release <X.Y.Z> --note <text> [--dry-run]
 *
 * `--dry-run` writes nothing and runs no test: it prints, per ledger, what the
 * freeze would record and the version it would set. Both modes fail when a
 * pending entry has an empty note, before anything is written.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareVersions,
  publishedPackages,
  RELEASE_VERSION_FILE,
} from "./release-packages.mjs";

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
    currentVersion: (root) => readManifestVersion(root, UPLINK_TOOLS_MANIFEST),
    versionName: "the uplink-tools surface",
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
 * What freezing a ledger would do, from its text, the version the code carries
 * and the release being cut: the pending keys, any with an empty note, the
 * version it lands on, and whether the code's version is one the ledger allows.
 */
export function planFreeze(ledgerText, carriedVersion, release) {
  const ledger = JSON.parse(ledgerText);
  const { breaks, additions } = ledger.pending;
  const emptyNotes = [...breaks, ...additions]
    .filter((change) => change.note.trim() === "")
    .map((change) => change.key);
  const latest = ledger.entries[ledger.entries.length - 1].version;
  const pending = breaks.length + additions.length > 0;
  const byRelease = ledger.versioning === "release";
  let next = null;
  if (pending) {
    next = byRelease
      ? release
      : nextVersion(latest, breaks.length > 0, ledger.versioning);
  }
  return {
    pending,
    breaks: breaks.map((change) => change.key),
    additions: additions.map((change) => change.key),
    emptyNotes,
    latest,
    carriedVersion,
    carriedAllowed: byRelease
      ? compareVersions(carriedVersion, latest) >= 0
      : carriedVersion === latest,
    byRelease,
    next,
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

function readManifestVersion(root, file) {
  return JSON.parse(readFileSync(join(root, file), "utf8")).version;
}

function setManifestVersion(root, file, version) {
  const path = join(root, file);
  writeFileSync(
    path,
    replaceManifestVersion(readFileSync(path, "utf8"), version),
  );
}

/** Every manifest a release moves: the app's, whose version is the release version, and each published package's. */
export function releaseManifests(root = REPO_ROOT) {
  return [
    RELEASE_VERSION_FILE,
    ...publishedPackages(root).map((pkg) => `${pkg.dir}/package.json`),
  ];
}

/**
 * Runs the lock's freeze for one ledger and returns the version it recorded.
 * The version is read back from the ledger's new latest entry, not from the
 * run's output: a passing vitest run does not show its console lines.
 */
function runFreeze(root, ledger, note, release) {
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
        GONOGO_SURFACE_RELEASE: release,
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
  const releaseAt = argv.indexOf("--release");
  const release = releaseAt === -1 ? "" : (argv[releaseAt + 1] ?? "");
  if (!/^\d+\.\d+\.\d+$/.test(release)) {
    throw new Error(
      "--release <X.Y.Z> is required: it is the version every package moves to",
    );
  }

  const plans = LEDGERS.map((ledger) => ({
    ledger,
    plan: planFreeze(
      readFileSync(join(root, ledger.file), "utf8"),
      ledger.currentVersion(root),
      release,
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
    if (!plan.carriedAllowed) {
      throw new Error(
        `${ledger.id}: the code carries ${plan.carriedVersion} but the ledger's latest entry is ${plan.latest}`,
      );
    }
    if (!plan.pending) {
      console.info(
        `${ledger.id}: nothing pending, ${ledger.versionName} stays at ${plan.latest}`,
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
    const printed = runFreeze(root, ledger, note, release);
    if (printed !== plan.next) {
      throw new Error(
        `${ledger.id}: the freeze printed ${printed} where ${plan.next} was planned`,
      );
    }
    ledger.setVersion?.(root, printed);
    moved.push(ledger.id);
  }

  const manifests = releaseManifests(root);
  console.info(`release ${release}: ${manifests.join(", ")}`);
  if (!dryRun) {
    for (const file of manifests) setManifestVersion(root, file, release);
  }
  console.info(
    dryRun
      ? "dry run: nothing written"
      : `froze: ${moved.join(", ") || "none"}; every manifest above is at ${release}`,
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
