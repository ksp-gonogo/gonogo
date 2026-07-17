#!/usr/bin/env node
/**
 * Gate a packed npm tarball before it is published.
 *
 * The kit bundles `@ksp-gonogo/theme` into `dist` on purpose (see
 * `packages/ui-kit/tsup.config.ts`). That bundling is invisible until it
 * breaks: if tsup ever stops inlining the theme, the tarball still packs
 * happily and only fails once an outside consumer — who cannot install a
 * `private: true` package — tries to import it. This script turns that into a
 * build failure instead of a broken publish.
 *
 * Checks, against the tarball rather than the source tree, because the tarball
 * is what consumers actually get:
 *
 *   1. `private: true` never publishes.
 *   2. No `@ksp-gonogo/*` in dependencies / peerDependencies /
 *      optionalDependencies — those are the fields a consumer's installer
 *      resolves. devDependencies are deliberately exempt: they are inert for
 *      consumers, and `npm publish` leaves pnpm's `workspace:*` ranges in them
 *      verbatim.
 *   3. No `@ksp-gonogo/*` *module specifier* in any emitted `.js`/`.d.ts`.
 *
 * Check 3 sweeps every emitted file, not just the entry: ui-kit bundles to a
 * single `index.js`, but sitrep-sdk emits a file per module, and an unbundled
 * import would just hide in a sibling.
 *
 * It also only counts real imports. `dist/index.d.ts` legitimately carries
 * doc-comment prose naming `@ksp-gonogo/theme` (it explains the bundling), so
 * a bare `grep @ksp-gonogo` false-positives on every build. Comments are
 * stripped before matching, and only quoted specifier positions count.
 *
 * Usage: node scripts/verify-package-artifact.mjs <tarball.tgz>
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const SCOPE = "@ksp-gonogo";
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
      // print — the null return is what the caller reports on.
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
};

/**
 * Remove comments so prose can't be mistaken for code.
 *
 * Block comments go first — they're the JSDoc that names `@ksp-gonogo/theme`
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
    String.raw`\/`,
  "g",
);

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
    `manifest is \`private: true\` — this package must never be published`,
  );
}

for (const field of RESOLVED_DEP_FIELDS) {
  for (const name of Object.keys(manifest[field] ?? {})) {
    if (name.startsWith(`${SCOPE}/`)) {
      failures.push(
        `${field}.${name} — a consumer cannot resolve a workspace package; ` +
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
      `${required} is missing from the tarball — did the build run?`,
    );
  }
}

for (const file of emitted) {
  const source = readFromTarball(file);
  if (source === null || source.trim() === "") {
    failures.push(`${file} is empty or unreadable — did the build run?`);
    continue;
  }
  const hits = stripComments(source).match(specifierPattern);
  if (hits) {
    failures.push(
      `${file} imports ${SCOPE}/* (${hits.length} ` +
        `${hits.length === 1 ? "specifier" : "specifiers"}) — it must be ` +
        `bundled, not referenced`,
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
    `no ${SCOPE} dependencies, no ${SCOPE} imports in dist.`,
);
