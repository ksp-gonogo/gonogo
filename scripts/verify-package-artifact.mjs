#!/usr/bin/env node
/**
 * Gate a packed npm tarball before it is published.
 *
 * The kit bundles `@ksp-gonogo/theme` into `dist` on purpose (see
 * `packages/ui-kit/tsup.config.ts`). That bundling is invisible until it
 * breaks: if tsup ever stops inlining the theme, the tarball still packs
 * happily and only fails once an outside consumer (who cannot install a
 * `private: true` package) tries to import it. This script turns that into a
 * build failure instead of a broken publish.
 *
 * Checks, against the tarball rather than the source tree, because the tarball
 * is what consumers actually get:
 *
 *   1. `private: true` never publishes.
 *   2. No `@ksp-gonogo/*` in dependencies / peerDependencies /
 *      optionalDependencies: those are the fields a consumer's installer
 *      resolves. devDependencies are deliberately exempt: they are inert for
 *      consumers, and `npm publish` leaves pnpm's `workspace:*` ranges in them
 *      verbatim.
 *   3. Every `@ksp-gonogo/*` *module specifier* in an emitted `.js`/`.d.ts`
 *      names a package a consumer can install: a published one, or the package
 *      itself. A `private: true` one cannot be installed and must be bundled.
 *   4. Every entry point the manifest declares (`main`, `types`, `bin`, and each
 *      leaf of `exports`) exists in the tarball and is built output rather than
 *      TypeScript source.
 *
 * Check 3 sweeps every emitted file, not just the entry: ui-kit bundles to a
 * single `index.js`, but sitrep-sdk emits a file per module, and an unbundled
 * import would just hide in a sibling.
 *
 * Check 4 is the only one that asks what a consumer's RESOLVER asks. The other
 * three inspect what is in the tarball; all three pass on a package whose
 * manifest sends nobody to any of it.
 *
 * It also only counts real imports. `dist/index.d.ts` legitimately carries
 * doc-comment prose naming `@ksp-gonogo/theme` (it explains the bundling), so
 * a bare `grep @ksp-gonogo` false-positives on every build. Comments are
 * stripped before matching, and only quoted specifier positions count.
 *
 * Usage: node scripts/verify-package-artifact.mjs <tarball.tgz>
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCOPE = "@ksp-gonogo";
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESOLVED_DEP_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
];

const tarball = process.argv[2];
if (!tarball || !existsSync(tarball)) {
  console.error(
    `usage: node scripts/verify-package-artifact.mjs <tarball.tgz>\n` +
      `no such tarball: ${tarball ?? "(none given)"}`,
  );
  process.exit(2);
}

/** Read one file out of the tarball without unpacking it to disk. */
const readFromTarball = (path) => {
  try {
    return execFileSync("tar", ["-xzOf", tarball, `package/${path}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // A missing member is an expected outcome (it's check 3), not noise to
      // print: the null return is what the caller reports on.
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
};

/**
 * Remove comments so prose can't be mistaken for code.
 *
 * Block comments go first: they're the JSDoc that names `@ksp-gonogo/theme`
 * in `dist/index.d.ts`, and the only real source of false positives. Line
 * comments are stripped only when `//` opens the line, so a `https://` inside
 * a string literal doesn't take the rest of that line (and any import on it)
 * away with it.
 */
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

/**
 * Match `@ksp-gonogo/*` only where a module specifier can actually appear:
 * `from "x"`, side-effect `import "x"`, `import("x")`, `require("x")`, and
 * `declare module "x"`. The quotes are what separate a real specifier from a
 * backticked mention in prose.
 */
const specifierPattern = new RegExp(
  String.raw`(?:from|import|require|declare\s+module)\s*\(?\s*["']` +
    SCOPE.replace("/", "\\/") +
    String.raw`\/([^"'\/]+)`,
  "g",
);

/**
 * Which `@ksp-gonogo/*` packages a consumer can actually install.
 *
 * The rule this file enforces is NOT "no `@ksp-gonogo` specifier in dist". That
 * was the rule, and it is wrong in the direction that matters: `ui-kit`
 * deliberately externalises `@ksp-gonogo/sitrep-sdk` (its tsup config explains
 * at length why bundling a second copy breaks React context identity across the
 * boundary), and the sdk is PUBLISHED, so a consumer resolves it perfectly well.
 * Under the blunt rule ui-kit could not pass its own publish gate, which is a
 * gate that blocks the correct artefact and would eventually be switched off.
 *
 * The real question is whether the named package is installable. `private: true`
 * answers it locally and deterministically, with no network call: that is the
 * same fact check 1 already tests, applied to the dependencies instead of to the
 * package itself. `theme` and `logger` are private, so a reference to either is
 * still a failure, which is what caught the sdk shipping `.d.ts` files importing
 * types from `@ksp-gonogo/logger`.
 */
const publishableScopePackages = () => {
  const roots = ["packages", "mod"];
  const found = new Map();
  for (const root of roots) {
    let entries;
    try {
      entries = readdirSync(join(REPO_ROOT, root), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      for (const dir of [
        join(REPO_ROOT, root, entry.name),
        join(REPO_ROOT, root, entry.name, "client"),
      ]) {
        try {
          const pkg = JSON.parse(
            readFileSync(join(dir, "package.json"), "utf8"),
          );
          if (
            typeof pkg.name === "string" &&
            pkg.name.startsWith(`${SCOPE}/`)
          ) {
            found.set(pkg.name.slice(SCOPE.length + 1), pkg.private !== true);
          }
        } catch {
          // Not a package directory; nothing to classify.
        }
      }
    }
  }
  if (found.size === 0) {
    console.error(
      `could not enumerate ${SCOPE} workspace packages from ${REPO_ROOT}: ` +
        `refusing to classify every specifier as unknown`,
    );
    process.exit(2);
  }
  return found;
};

const scopePackages = publishableScopePackages();

const failures = [];

// ── 1 + 2: the manifest ──────────────────────────────────────────────────────
const manifestRaw = readFromTarball("package.json");
if (!manifestRaw) {
  console.error(`could not read package/package.json from ${tarball}`);
  process.exit(2);
}
const manifest = JSON.parse(manifestRaw);

if (manifest.private === true) {
  failures.push(
    `manifest is \`private: true\`, this package must never be published`,
  );
}

for (const field of RESOLVED_DEP_FIELDS) {
  for (const name of Object.keys(manifest[field] ?? {})) {
    if (name.startsWith(`${SCOPE}/`)) {
      failures.push(
        `${field}.${name}: a consumer cannot resolve a workspace package; ` +
          `bundle it into dist instead`,
      );
    }
  }
}

// ── 3: the emitted code ──────────────────────────────────────────────────────
const listTarball = () =>
  execFileSync("tar", ["-tzf", tarball], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, ""));

const members = listTarball();
const emitted = members.filter((file) => /\.(js|mjs|cjs|d\.ts)$/.test(file));

// The entry points are named explicitly: a build that emitted nothing would
// otherwise sweep an empty list and pass.
for (const required of ["dist/index.js", "dist/index.d.ts"]) {
  if (!members.includes(required)) {
    failures.push(
      `${required} is missing from the tarball, did the build run?`,
    );
  }
}

for (const file of emitted) {
  const source = readFromTarball(file);
  if (source === null || source.trim() === "") {
    failures.push(`${file} is empty or unreadable, did the build run?`);
    continue;
  }
  const selfName = manifest.name.slice(SCOPE.length + 1);
  for (const hit of stripComments(source).matchAll(specifierPattern)) {
    const named = hit[1];
    if (named === selfName) continue; // a self-reference resolves for a consumer
    const publishable = scopePackages.get(named);
    if (publishable === true) continue; // installable from the registry
    failures.push(
      publishable === false
        ? `${file} imports ${SCOPE}/${named}, which is \`private: true\` and never ` +
            `published: a consumer cannot install it, so this must be bundled into dist`
        : `${file} imports ${SCOPE}/${named}, which is not a package in this workspace: ` +
            `either it was renamed or the specifier is wrong`,
    );
  }
}

// ── 4: the manifest's entry points, which decide what a consumer resolves ────
//
// Checks 1-3 all look at what is IN the tarball. None of them asks the question
// a consumer's resolver asks first: where does this manifest point?
//
// `mod/sitrep-sdk` points `main` and `exports` at `./src/*.ts` because the
// workspace consumes it as source, and redirects both at `./dist/*.js` through
// `publishConfig` for consumers. **npm ignores that.** It treats `publishConfig`
// as config, never as manifest overrides, and says so out loud:
//
//     npm warn Unknown publishConfig config "main".
//     npm warn Unknown publishConfig config "exports".
//
// `release.yml` publishes with npm, for OIDC provenance. So the tarball it
// uploads would carry the source-pointing manifest, and `files` ships `src`, so
// it RESOLVES: the package installs fine and hands raw TypeScript to the
// consumer's bundler. It breaks later, in somebody else's build, pointing at
// their tooling. Checks 1-3 pass on that tarball; every file they inspect is
// correct, and the manifest sends nobody to any of them.
//
// `scripts/pack-publishable.mjs` applies the overrides. This refuses to believe
// it happened.
const declaredTargets = () => {
  const targets = new Set();
  const collect = (value) => {
    if (typeof value === "string") {
      if (value.startsWith("./") || !value.includes(":")) targets.add(value);
      return;
    }
    if (value && typeof value === "object") {
      for (const nested of Object.values(value)) collect(nested);
    }
  };
  for (const field of [
    "main",
    "module",
    "types",
    "typings",
    "browser",
    "bin",
  ]) {
    collect(manifest[field]);
  }
  collect(manifest.exports);
  return [...targets];
};

for (const field of [
  "main",
  "module",
  "types",
  "typings",
  "browser",
  "exports",
  "bin",
  "files",
  "imports",
]) {
  if (manifest.publishConfig && field in manifest.publishConfig) {
    failures.push(
      `publishConfig.${field} survives in the published manifest, and npm IGNORES it ` +
        `(run \`npm publish --dry-run\` and it says "Unknown publishConfig config"). ` +
        `Whatever \`${field}\` is at the top level is what consumers get. Pack with ` +
        `scripts/pack-publishable.mjs, which applies the override.`,
    );
  }
}

for (const target of declaredTargets()) {
  const relative = target.replace(/^\.\//, "");
  // A wildcard subpath cannot be resolved to one member; the file sweep in
  // check 3 already covers whatever it expands to.
  if (relative.includes("*")) continue;
  if (!members.includes(relative)) {
    failures.push(
      `the manifest points at ${target}, which is not in the tarball: a consumer ` +
        `resolving that entry gets ERR_MODULE_NOT_FOUND`,
    );
    continue;
  }
  if (/\.tsx?$/.test(relative) && !/\.d\.ts$/.test(relative)) {
    failures.push(
      `the manifest points at ${target}, which is TypeScript SOURCE. Consumers get ` +
        `an unbuilt package that only fails once their own bundler reaches it.`,
    );
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(
    `\n${manifest.name}@${manifest.version} is NOT publishable:\n` +
      failures.map((f) => `  ✗ ${f}`).join("\n") +
      "\n",
  );
  process.exit(1);
}

console.log(
  `${manifest.name}@${manifest.version} looks publishable: ` +
    `no ${SCOPE} dependencies, every ${SCOPE} specifier in dist names a published ` +
    `package, and every manifest entry point resolves to a built file.`,
);
