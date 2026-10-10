#!/usr/bin/env node
/**
 * The version of every published package, for a release and for a release
 * candidate.
 *
 * Every package this repo publishes carries ONE version, the release version:
 * `@ksp-gonogo/sitrep-sdk`, `@ksp-gonogo/ui-kit` and `@ksp-gonogo/uplink-tools`
 * on npm and `KspGonogo.Sitrep.Contract` on nuget.org. It is the app's own
 * version (`packages/app/package.json`), so a `v*` tag, the images, the mod zips
 * and every package of one release share a number. The wire contract's
 * `Major.Minor` and `EXTENSION_API_VERSION` are compatibility stamps the host
 * checks at load, not package versions, and move by their own rules.
 *
 * ## The next release
 *
 * The app's version moved by a bump, or an exact version given instead (the
 * only way to reset the line or to name a 1.0). `auto` reads the conventional
 * commits since the last `v*` tag: a break moves the major, a feature the minor,
 * anything else the patch. Either way the result is refused unless it sorts
 * above every version already published of every package on its registry, and
 * its `v*` tag does not exist yet: a version is spent once, everywhere.
 *
 * ## A withdrawn version
 *
 * A version taken back from a registry no longer counts as published, so it
 * cannot block a lower one. The registries say so differently, and the planner
 * reads each at the place that tells the truth: npm drops an unpublished
 * version from the packument and marks a deprecated one; nuget.org keeps an
 * unlisted version in its flat container for ever, so the registration's
 * `listed` flag is read instead. `withdrawn-versions.json` repeats the same
 * answer in the repository, one reason per version, so the rule does not rest on
 * a registry quirk. A withdrawn number is never reused: planning it is refused.
 *
 * ## A release candidate
 *
 * `<release>-rc.<n>` for every package at once, `n` the workflow run number. It
 * is unique per run of `release.yml` and only grows, and SemVer compares a
 * numeric identifier numerically, so `rc.10` sorts above `rc.9`. A re-run
 * attempt keeps its number, so finding its own RC already published is allowed:
 * release.yml skips that package and its fossil check compares the copy.
 *
 * ## Sibling pins
 *
 * Every `@ksp-gonogo` package a packed manifest resolves is pinned to the same
 * version, exactly, in a release and in an RC. ui-kit and uplink-tools also
 * import the sdk without declaring it (a workspace peer would break the
 * workspace's own resolution, see ui-kit's tsup config), so a published sibling
 * the package's workspace manifest names AND its dist imports is added as an
 * exact peer. Nothing here writes to the tree: the freeze moves the versions in
 * the release commit, and the stamp applies them to the packed tarball.
 *
 * Usage:
 *   release-packages.mjs plan (--bump <auto|patch|minor|major> | --version <X.Y.Z>) [--rc <n>]
 *   release-packages.mjs stamp <tarball> <version> <out-dir>   prints the stamped tarball
 *   release-packages.mjs check <tarball> <version>             the packed manifest agrees
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
import { makeTempDir } from "./temp-dir.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCOPE = "@ksp-gonogo/";
const RESOLVED_DEP_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
];
const RELEASE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const ANY_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** The file whose version is the release version of everything this repo ships. */
export const RELEASE_VERSION_FILE = "packages/app/package.json";
export const NUGET_ID = "KspGonogo.Sitrep.Contract";

/** The release version the tree carries: the last release, until the next release commit moves it. */
export function treeRelease(root = REPO_ROOT) {
  return JSON.parse(readFileSync(join(root, RELEASE_VERSION_FILE), "utf8"))
    .version;
}

/** Every package this repo publishes to npm: not private, with an export map, the same rule the probe and the isolation gate use. */
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

function parse(version) {
  const match = ANY_VERSION.exec(version);
  if (!match) throw new Error(`${version} is not a version`);
  return {
    core: match.slice(1, 4).map(Number),
    pre: match[4] === undefined ? [] : match[4].split("."),
  };
}

/** SemVer precedence: negative, zero or positive as `a` sorts below, with or above `b`. */
export function compareVersions(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++)
    if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (x.pre.length === 0 || y.pre.length === 0)
    return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const numeric = /^\d+$/.test(p) && /^\d+$/.test(q);
    if (numeric) return Number(p) - Number(q);
    return p < q ? -1 : 1;
  }
  return 0;
}

/** The bump the conventional commits in a log call for; an empty log means the tree is already released. */
export function bumpFromLog(log) {
  if (log.trim() === "") {
    throw new Error(
      "no commits since the last release tag: this tree is already released. Nothing to cut.",
    );
  }
  if (/^BREAKING CHANGE|^[a-z]+(\([^)]+\))?!:/m.test(log)) return "major";
  if (/^feat(\([^)]+\))?:/m.test(log)) return "minor";
  return "patch";
}

export function nextRelease(current, bump) {
  const match = RELEASE_VERSION.exec(current);
  if (!match) throw new Error(`${current} is not a release version`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`unknown bump ${bump}`);
}

/**
 * The version this run publishes for every package, refused unless it sorts
 * above everything already published and its tag is unspent. `run` makes it an
 * RC; an RC may find exactly itself published, which is a re-run attempt.
 */
export function plan({
  root = REPO_ROOT,
  release,
  run,
  npmVersions,
  nugetVersions,
  tags,
  withdrawn = withdrawnVersions(),
}) {
  if (!RELEASE_VERSION.test(release ?? "")) {
    throw new Error(`${release} is not a release version (X.Y.Z)`);
  }
  if (run !== undefined && (!Number.isInteger(run) || run < 1)) {
    throw new Error(`the run number must be a positive integer, got ${run}`);
  }
  const version = run === undefined ? release : `${release}-rc.${run}`;
  const tag = `v${release}`;
  if (tags.includes(tag)) {
    throw new Error(
      `the tag ${tag} already exists, so ${release} is spent: pick a version above it, or delete that tag and its GitHub release first`,
    );
  }
  const spent = withdrawn.find((entry) => entry.version === version);
  if (spent) {
    throw new Error(
      `${version} was withdrawn (${spent.reason}), and a withdrawn number is never reused: pick another`,
    );
  }
  const live = (versions) =>
    versions.filter((v) => !withdrawn.some((entry) => entry.version === v));
  nugetVersions = live(nugetVersions);
  const packages = {};
  const registries = [];
  for (const pkg of publishedPackages(root)) {
    const published = live(npmVersions(pkg.name));
    packages[pkg.name] = { dir: pkg.dir, firstVersion: published.length === 0 };
    registries.push({ name: pkg.name, published });
  }
  registries.push({ name: NUGET_ID, published: nugetVersions });
  for (const { name, published } of registries) {
    for (const other of published) {
      const reRun = run !== undefined && other === version;
      if (reRun || compareVersions(other, version) < 0) continue;
      throw new Error(
        `${name} has ${other} published, which does not sort below ${version}: every package carries one version, so it must be above everything any of them has published`,
      );
    }
  }
  return {
    release,
    version,
    tag,
    packages,
    nuget: { id: NUGET_ID, firstVersion: nugetVersions.length === 0 },
  };
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
 * The published manifest: the release version, every sibling it resolves pinned
 * to that version, and every published sibling its workspace manifest names and
 * its dist imports added as an exact peer.
 */
export function stampManifest(
  manifest,
  version,
  siblings,
  workspaceManifest,
  imported,
) {
  const out = structuredClone(manifest);
  out.version = version;
  const pinned = [];
  for (const field of RESOLVED_DEP_FIELDS) {
    for (const name of Object.keys(out[field] ?? {})) {
      if (!siblings.has(name)) continue;
      out[field][name] = version;
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
    if (!siblings.has(name) || name === manifest.name) continue;
    if (!String(range).startsWith("workspace:")) continue;
    if (!imported.has(name) || declared.has(name)) continue;
    out.peerDependencies = { ...out.peerDependencies, [name]: version };
    added.push(`peerDependencies.${name}`);
  }
  return { manifest: out, pinned, added };
}

/** Every disagreement between a packed manifest and the version it must ship as; empty when it agrees. */
export function auditManifest(manifest, version, siblings) {
  const failures = [];
  if (manifest.version !== version) {
    failures.push(`version is ${manifest.version}, the release is ${version}`);
  }
  for (const field of RESOLVED_DEP_FIELDS) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (!name.startsWith(SCOPE)) continue;
      if (!siblings.has(name)) {
        failures.push(
          `${field}.${name} is not a published package of this release`,
        );
        continue;
      }
      if (range !== version) {
        failures.push(`${field}.${name} is ${range}, not exactly ${version}`);
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

const siblingNames = (root) =>
  new Set(publishedPackages(root).map((pkg) => pkg.name));

/** Re-tars a packed tarball with its published manifest; returns the new tarball's path. */
export function stampTarball(tarball, version, outDir, root = REPO_ROOT) {
  const work = makeTempDir("gonogo-release-stamp-");
  try {
    execFileSync("tar", ["-xzf", tarball, "-C", work]);
    const manifestPath = join(work, "package", "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const own = publishedPackages(root).find((p) => p.name === manifest.name);
    if (!own) throw new Error(`${manifest.name} is not a published package`);
    const workspaceManifest = JSON.parse(
      readFileSync(join(root, own.dir, "package.json"), "utf8"),
    );
    const imported = new Set();
    for (const source of emittedSources(join(work, "package"))) {
      for (const name of importedScopePackages(source)) imported.add(name);
    }
    const stamped = stampManifest(
      manifest,
      version,
      siblingNames(root),
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
      `${manifest.name.slice(1).replace("/", "-")}-${version}.tgz`,
    );
    /* `COPYFILE_DISABLE` for the reason pack-publishable.mjs gives: macOS tar otherwise archives AppleDouble sidecars. */
    execFileSync("tar", ["-czf", out, "-C", work, "package"], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    console.error(
      `release-packages: ${manifest.name}@${version}, pinned ${stamped.pinned.join(", ") || "nothing"}, added ${stamped.added.join(", ") || "nothing"}`,
    );
    return out;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export const WITHDRAWN_VERSIONS_FILE = "scripts/withdrawn-versions.json";

/** The committed list of versions taken back from the registries, each with its reason. */
export function withdrawnVersions(root = REPO_ROOT) {
  const entries = JSON.parse(
    readFileSync(join(root, WITHDRAWN_VERSIONS_FILE), "utf8"),
  );
  for (const entry of entries) {
    if (!entry.version || !entry.reason) {
      throw new Error(
        `${WITHDRAWN_VERSIONS_FILE}: every entry needs a version and a reason, got ${JSON.stringify(entry)}`,
      );
    }
  }
  return entries;
}

/** Versions still installable from the registry: unpublished ones are absent, deprecated ones are withdrawn. */
export function liveNpmVersions(packument) {
  return Object.entries(packument.versions ?? {})
    .filter(([, manifest]) => !manifest.deprecated)
    .map(([version]) => version);
}

/** Versions nuget.org lists: an unlisted one stays in the flat container, so only the registration says. */
export function listedNugetVersions(leaves) {
  return leaves
    .filter((leaf) => leaf.catalogEntry.listed !== false)
    .map((leaf) => leaf.catalogEntry.version);
}

async function npmVersionsFromRegistry(name) {
  const response = await fetch(
    `https://registry.npmjs.org/${name.replace("/", "%2F")}`,
    { headers: { accept: "application/vnd.npm.install-v1+json" } },
  );
  // Only a 404 means "never published": reading an outage as absence would plan a first publish.
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`npm answered ${response.status} for ${name}`);
  }
  return liveNpmVersions(await response.json());
}

async function nugetVersions(id) {
  const base = `https://api.nuget.org/v3/registration5-gz-semver2/${id.toLowerCase()}`;
  const first = await fetch(`${base}/index.json`);
  if (first.status === 404) return [];
  if (!first.ok) {
    throw new Error(`nuget.org answered ${first.status} for ${id}`);
  }
  const leaves = [];
  for (const page of (await first.json()).items) {
    // A large history is paged: the index lists a page by URL and inlines only some.
    let items = page.items;
    if (!items) {
      const response = await fetch(page["@id"]);
      if (!response.ok) {
        throw new Error(
          `nuget.org answered ${response.status} for ${page["@id"]}`,
        );
      }
      items = (await response.json()).items;
    }
    leaves.push(...items);
  }
  return listedNugetVersions(leaves);
}

/** A whole history's log runs to tens of megabytes when no release tag is reachable. */
const git = (root, args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

function releaseTags(root) {
  return git(root, ["tag", "--list", "v*"]).split("\n").filter(Boolean);
}

/** The commit subjects and bodies since the last `v*` tag; an `rc-*` tag is not a release. */
function logSinceRelease(root) {
  let last = "";
  try {
    last = git(root, [
      "describe",
      "--tags",
      "--abbrev=0",
      "--match",
      "v*",
    ]).trim();
  } catch {
    last = "";
  }
  return git(root, [
    "log",
    "--format=%s%n%b",
    ...(last ? [`${last}..HEAD`] : []),
  ]);
}

function flag(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

export async function main(
  argv,
  {
    root = REPO_ROOT,
    npm = npmVersionsFromRegistry,
    nuget = nugetVersions,
    tags = () => releaseTags(root),
    log = () => logSinceRelease(root),
    print = console.log,
  } = {},
) {
  const [command, ...rest] = argv;
  switch (command) {
    case "plan": {
      const explicit = flag(rest, "--version");
      const bump = flag(rest, "--bump");
      if (!explicit && !bump) throw new Error("plan needs --bump or --version");
      const current = treeRelease(root);
      const release =
        explicit ||
        nextRelease(current, bump === "auto" ? bumpFromLog(log()) : bump);
      const runFlag = flag(rest, "--rc");
      const npmByName = {};
      for (const pkg of publishedPackages(root)) {
        npmByName[pkg.name] = await npm(pkg.name);
      }
      const result = plan({
        root,
        release,
        run: runFlag === undefined ? undefined : Number(runFlag),
        npmVersions: (name) => npmByName[name],
        nugetVersions: await nuget(NUGET_ID),
        tags: tags(),
      });
      console.error(
        `release ${result.release} (the tree is at ${current}${explicit ? ", version given" : `, bump ${bump}`}): every package publishes ${result.version}`,
      );
      for (const [name, entry] of Object.entries(result.packages)) {
        if (entry.firstVersion)
          console.error(`${name}: first version of the package`);
      }
      if (result.nuget.firstVersion)
        console.error(`${NUGET_ID}: first version of the package`);
      print(JSON.stringify(result));
      return result;
    }
    case "stamp": {
      const [tarball, version, outDir] = rest;
      const out = stampTarball(tarball, version, outDir, root);
      print(out);
      return out;
    }
    case "check": {
      const [tarball, version] = rest;
      const manifest = readManifestFromTarball(tarball);
      const failures = auditManifest(manifest, version, siblingNames(root));
      if (failures.length > 0) {
        throw new Error(
          `${manifest.name}@${manifest.version} is not what this release ships:\n${failures.map((f) => `  ${f}`).join("\n")}`,
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
    default:
      throw new Error(
        "usage: release-packages.mjs plan (--bump <auto|patch|minor|major> | --version <X.Y.Z>) [--rc <n>] | stamp <tarball> <version> <out-dir> | check <tarball> <version>",
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
