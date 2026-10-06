#!/usr/bin/env node
/**
 * Release candidates of the published packages, for `release.yml`'s `rc` mode.
 *
 * An RC is a prerelease of the version the NEXT release would publish, never of
 * one already on the registry: `0.1.0-rc.1` sorts below a published `0.1.0`, so
 * an RC of a published version is unreachable to every `^` range and reads as
 * older than what it tests. Nothing here writes to the tree. Versions are
 * computed in the job and applied only to the packed tarball's manifest.
 *
 * ## The next version
 *
 * First what a release of this tree would carry: the package's own version,
 * except where a surface ledger moves it at the freeze (uplink-tools), which
 * contributes the version that freeze plans. If that version is not on the
 * registry it is the next one. If it is, it is bumped by the ledgers' pending
 * changes for that package, with the 0.x rule below 1.0.0 (a break moves the
 * minor, an addition the patch), and by a patch when nothing is pending: the
 * smallest version that sorts above the published one.
 *
 * ## The suffix
 *
 * `-rc.<n>`, `n` the workflow run number. It is unique per run of `release.yml`
 * and only ever grows, and SemVer compares a numeric identifier numerically, so
 * `rc.10` sorts above `rc.9`. Every package in one run shares it, which is what
 * lets each RC name its siblings exactly. A re-run attempt keeps the number, so
 * a package an earlier attempt already published is skipped by release.yml's
 * own "already on npm" step, and its fossil check compares that copy.
 *
 * ## Sibling pins
 *
 * Every `@ksp-gonogo` package an RC's manifest resolves is pinned to that
 * sibling's RC from the same run, exactly. ui-kit and uplink-tools also import
 * the sdk without declaring it (a workspace peer would break the workspace's own
 * resolution, see ui-kit's tsup config), so a published sibling the package's
 * workspace manifest names AND its dist imports is added as an exact peer.
 *
 * Usage:
 *   rc-packages.mjs plan --run <n>                    the plan, as JSON on stdout
 *   rc-packages.mjs stamp <tarball> <plan> <out-dir>  prints the stamped tarball
 *   rc-packages.mjs check <tarball> <plan>            the packed manifest agrees
 *   rc-packages.mjs nuget --tree <version> --run <n>  the NuGet RC version
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LEDGERS,
  nextVersion,
  planFreeze,
} from "./freeze-published-surface.mjs";
import { makeTempDir } from "./temp-dir.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCOPE = "@ksp-gonogo/";
const RESOLVED_DEP_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
];
const RELEASE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const RC_VERSION = /^\d+\.\d+\.\d+-rc\.\d+$/;

/** Every package this repo publishes: not private, with an export map, the same rule the probe and the isolation gate use. */
export function publishedPackages(root = REPO_ROOT) {
  const found = [];
  for (const top of ["packages", "mod"]) {
    const base = join(root, top);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = `${top}/${entry.name}`;
      const path = join(root, dir, "package.json");
      if (!existsSync(path)) continue;
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      if (!manifest.name || manifest.private === true || !manifest.exports)
        continue;
      found.push({ name: manifest.name, dir, version: manifest.version });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

function core(version) {
  const match = RELEASE_VERSION.exec(version.split("-")[0]);
  if (!match) throw new Error(`${version} is not a version`);
  return match.slice(1).map(Number);
}

function compareCore(a, b) {
  const [x, y] = [core(a), core(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The version after `version` for a pending change set: `break`, `addition` or `none`. */
export function bump(version, level) {
  const zeroMajor = core(version)[0] === 0;
  if (level === "none") {
    const [major, minor, patch] = core(version);
    return `${major}.${minor}.${patch + 1}`;
  }
  return nextVersion(
    version,
    level === "break",
    zeroMajor ? "zero-major" : "semver",
  );
}

/** The strongest pending change any ledger records against this package. */
export function pendingLevel(ledgerTexts, packageName) {
  const prefix = `${packageName.slice(SCOPE.length)} `;
  let level = "none";
  for (const text of ledgerTexts) {
    const { pending } = JSON.parse(text);
    if (pending.breaks.some((change) => change.key.startsWith(prefix)))
      return "break";
    if (pending.additions.some((change) => change.key.startsWith(prefix)))
      level = "addition";
  }
  return level;
}

/**
 * One package's RC from what a release would carry, its pending level, the
 * versions already on the registry and the run number. A package with nothing
 * published gets an RC of the version a release would carry, and says so in
 * `firstVersion`: npm may make that RC the package's `latest` whatever the tag.
 */
export function planPackage({ release, level, published, run }) {
  if (!Number.isInteger(run) || run < 1) {
    throw new Error(`the run number must be a positive integer, got ${run}`);
  }
  const base = published.includes(release) ? bump(release, level) : release;
  const releases = published.filter((v) => RELEASE_VERSION.test(v));
  const above = releases.find((v) => compareCore(base, v) <= 0);
  if (above) {
    throw new Error(
      `${base} does not sort above the published ${above}, so its RC would read as older than what is out`,
    );
  }
  return {
    base,
    version: `${base}-rc.${run}`,
    firstVersion: published.length === 0,
  };
}

/** The plan for every published package, given each one's published versions. */
export function plan({ root = REPO_ROOT, run, publishedVersions }) {
  const ledgerTexts = LEDGERS.map((ledger) =>
    readFileSync(join(root, ledger.file), "utf8"),
  );
  const packages = {};
  for (const pkg of publishedPackages(root)) {
    let release = pkg.version;
    const owner = LEDGERS.find((ledger) => ledger.package === pkg.name);
    if (owner) {
      const freeze = planFreeze(
        readFileSync(join(root, owner.file), "utf8"),
        pkg.version,
      );
      release = freeze.next ?? pkg.version;
    }
    const level = pendingLevel(ledgerTexts, pkg.name);
    packages[pkg.name] = {
      dir: pkg.dir,
      tree: pkg.version,
      release,
      level,
      ...planPackage({
        release,
        level,
        published: publishedVersions(pkg.name),
        run,
      }),
    };
  }
  return { run, packages };
}

/**
 * The `@ksp-gonogo` packages a module specifier in this source names, ignoring
 * comments, the same positions verify-package-artifact.mjs counts.
 */
export function importedScopePackages(source) {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  const pattern =
    /(?:from|import|require|declare\s+module)\s*\(?\s*["']@ksp-gonogo\/([^"'/]+)/g;
  return new Set([...code.matchAll(pattern)].map((hit) => `${SCOPE}${hit[1]}`));
}

/**
 * The RC manifest: its own RC version, every sibling it resolves pinned to that
 * sibling's RC, and every published sibling its workspace manifest names and its
 * dist imports added as an exact peer.
 */
export function stampManifest(manifest, rcPlan, workspaceManifest, imported) {
  const own = rcPlan.packages[manifest.name];
  if (!own) throw new Error(`${manifest.name} is not in the RC plan`);
  const out = structuredClone(manifest);
  out.version = own.version;
  const pinned = [];
  for (const field of RESOLVED_DEP_FIELDS) {
    for (const name of Object.keys(out[field] ?? {})) {
      const sibling = rcPlan.packages[name];
      if (!sibling) continue;
      out[field][name] = sibling.version;
      pinned.push(`${field}.${name}`);
    }
  }
  const declared = new Set(
    RESOLVED_DEP_FIELDS.flatMap((field) => Object.keys(out[field] ?? {})),
  );
  const added = [];
  for (const [name, range] of Object.entries(
    workspaceManifest.devDependencies ?? {},
  )) {
    const sibling = rcPlan.packages[name];
    if (!sibling || name === manifest.name) continue;
    if (!String(range).startsWith("workspace:")) continue;
    if (!imported.has(name) || declared.has(name)) continue;
    out.peerDependencies = { ...out.peerDependencies, [name]: sibling.version };
    added.push(`peerDependencies.${name}`);
  }
  return { manifest: out, pinned, added };
}

/** Every disagreement between a packed manifest and the plan; empty when it is the RC the plan names. */
export function auditManifest(manifest, rcPlan) {
  const failures = [];
  const own = rcPlan.packages[manifest.name];
  if (!own) return [`${manifest.name} is not in the RC plan`];
  if (manifest.version !== own.version) {
    failures.push(
      `version is ${manifest.version}, the plan says ${own.version}`,
    );
  }
  if (!RC_VERSION.test(manifest.version)) {
    failures.push(`${manifest.version} is not an -rc.<n> prerelease`);
  }
  for (const field of RESOLVED_DEP_FIELDS) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (!name.startsWith(SCOPE)) continue;
      const sibling = rcPlan.packages[name];
      if (!sibling) {
        failures.push(`${field}.${name} is not a package this run plans`);
        continue;
      }
      if (range !== sibling.version) {
        failures.push(
          `${field}.${name} is ${range}, not exactly ${sibling.version}`,
        );
      }
    }
  }
  return failures;
}

function readManifestFromTarball(tarball) {
  return JSON.parse(
    execFileSync("tar", ["-xzOf", tarball, "package/package.json"], {
      encoding: "utf8",
    }),
  );
}

function emittedSources(packageDir) {
  const sources = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (/\.(js|mjs|cjs|d\.ts)$/.test(entry.name))
        sources.push(readFileSync(path, "utf8"));
    }
  };
  if (existsSync(join(packageDir, "dist"))) walk(join(packageDir, "dist"));
  return sources;
}

/** Re-tars a packed tarball with its RC manifest; returns the new tarball's path. */
export function stampTarball(tarball, rcPlan, outDir, root = REPO_ROOT) {
  const work = makeTempDir("gonogo-rc-stamp-");
  try {
    execFileSync("tar", ["-xzf", tarball, "-C", work]);
    const manifestPath = join(work, "package", "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const own = rcPlan.packages[manifest.name];
    if (!own) throw new Error(`${manifest.name} is not in the RC plan`);
    const workspaceManifest = JSON.parse(
      readFileSync(join(root, own.dir, "package.json"), "utf8"),
    );
    const imported = new Set();
    for (const source of emittedSources(join(work, "package"))) {
      for (const name of importedScopePackages(source)) imported.add(name);
    }
    const stamped = stampManifest(
      manifest,
      rcPlan,
      workspaceManifest,
      imported,
    );
    writeFileSync(
      manifestPath,
      `${JSON.stringify(stamped.manifest, null, 2)}\n`,
    );
    mkdirSync(resolve(outDir), { recursive: true });
    const out = join(
      resolve(outDir),
      `${manifest.name.slice(1).replace("/", "-")}-${own.version}.tgz`,
    );
    /* `COPYFILE_DISABLE` for the reason pack-publishable.mjs gives: macOS tar otherwise archives AppleDouble sidecars. */
    execFileSync("tar", ["-czf", out, "-C", work, "package"], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    console.error(
      `rc-packages: ${manifest.name}@${own.version}, pinned ${stamped.pinned.join(", ") || "nothing"}, added ${stamped.added.join(", ") || "nothing"}`,
    );
    return out;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The NuGet RC: the tree's version when it is unpublished, else its next patch. */
export function nugetRc(tree, published, run) {
  return planPackage({ release: tree, level: "none", published, run }).version;
}

function npmVersions(name) {
  try {
    const out = execFileSync("npm", ["view", name, "versions", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    // Only a 404 means "never published": reading an outage as absence would plan a first publish.
    if (/E404/.test(String(error.stderr ?? error.stdout ?? ""))) return [];
    throw new Error(`could not read ${name}'s versions from npm: ${error}`);
  }
}

async function nugetVersions(id) {
  const response = await fetch(
    `https://api.nuget.org/v3-flatcontainer/${id.toLowerCase()}/index.json`,
  );
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`nuget.org answered ${response.status} for ${id}`);
  }
  return (await response.json()).versions;
}

function flag(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

export async function main(
  argv,
  {
    root = REPO_ROOT,
    npm = npmVersions,
    nuget = nugetVersions,
    print = console.log,
  } = {},
) {
  const [command, ...rest] = argv;
  const readPlan = (path) => JSON.parse(readFileSync(path, "utf8"));
  switch (command) {
    case "plan": {
      const result = plan({
        root,
        run: Number(flag(rest, "--run")),
        publishedVersions: npm,
      });
      for (const [name, entry] of Object.entries(result.packages)) {
        console.error(
          `${name}: tree ${entry.tree}, release ${entry.release}, pending ${entry.level} -> ${entry.version}${entry.firstVersion ? " (first version of the package)" : ""}`,
        );
      }
      print(JSON.stringify(result));
      return result;
    }
    case "stamp": {
      const [tarball, planPath, outDir] = rest;
      const out = stampTarball(tarball, readPlan(planPath), outDir, root);
      print(out);
      return out;
    }
    case "check": {
      const [tarball, planPath] = rest;
      const manifest = readManifestFromTarball(tarball);
      const failures = auditManifest(manifest, readPlan(planPath));
      if (failures.length > 0) {
        throw new Error(
          `${manifest.name}@${manifest.version} is not the RC the plan names:\n${failures.map((f) => `  ${f}`).join("\n")}`,
        );
      }
      const pins = RESOLVED_DEP_FIELDS.flatMap((field) =>
        Object.entries(manifest[field] ?? {})
          .filter(([name]) => name.startsWith(SCOPE))
          .map(([name, range]) => `${field}.${name} = ${range}`),
      );
      print(
        `${manifest.name}@${manifest.version}: ${pins.length > 0 ? pins.join(", ") : "no @ksp-gonogo siblings"}, each exact`,
      );
      return manifest;
    }
    case "nuget": {
      const id = flag(rest, "--id") ?? "KspGonogo.Sitrep.Contract";
      const version = nugetRc(
        flag(rest, "--tree"),
        await nuget(id),
        Number(flag(rest, "--run")),
      );
      print(version);
      return version;
    }
    default:
      throw new Error(
        "usage: rc-packages.mjs plan --run <n> | stamp <tarball> <plan> <out-dir> | check <tarball> <plan> | nuget --tree <version> --run <n>",
      );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      `::error::${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
