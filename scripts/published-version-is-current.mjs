#!/usr/bin/env node
/**
 * Refuse to "skip, already published" when the published version is a fossil.
 *
 * `release.yml` publishes a package only when its own version has moved:
 * `npm view "$NAME@$VERSION"` hits, so it logs "already published, nothing to
 * do" and skips. That is right for a package nobody touched, and it is exactly
 * wrong for `@ksp-gonogo/sitrep-sdk`, which sat at `0.0.1` on both sides from
 * its first publish onwards. The check said "unchanged" on every release while
 * the workspace copy grew an entire framework surface, and the registry copy
 * stayed whatever it was on day one. Measured against the ten Uplinks in this
 * repo, 249 of 292 import bindings did not resolve against it.
 *
 * Nothing was going to notice, because the skip is indistinguishable from the
 * healthy case: both print a green step saying there was nothing to do.
 *
 * So this compares CONTENT, not version numbers. If the published tarball's
 * emitted files differ from the ones we just packed, the version is stale and
 * the release fails asking for a bump, instead of skipping into another year of
 * fossil.
 *
 * Only `dist` members are compared. `src` ships in the sdk's tarball and is not
 * what a consumer resolves, and comparing it would make a comment reflow look
 * like an API change. Sourcemaps are excluded for the same reason with more
 * force: they embed absolute-ish source paths and differ between machines.
 *
 * Usage: node scripts/published-version-is-current.mjs <name> <version> <packed.tgz>
 * Exit 0 = the published copy matches, skipping is safe.
 * Exit 1 = published content differs, the version needs a bump.
 * Exit 3 = not published at all, the caller should publish.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [name, version, packed] = process.argv.slice(2);
if (!name || !version || !packed) {
  console.error(
    "usage: node scripts/published-version-is-current.mjs <name> <version> <packed.tgz>",
  );
  process.exit(2);
}

/** sha256 per `dist` member, keyed by path, from an npm tarball. */
const distDigest = (tarball) => {
  const listing = execFileSync("tar", ["-tzf", tarball], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, ""))
    .filter((entry) => entry.startsWith("dist/"))
    .filter((entry) => !entry.endsWith(".map"))
    .filter((entry) => !entry.endsWith("/"))
    .sort();

  const digest = new Map();
  for (const member of listing) {
    const bytes = execFileSync("tar", ["-xzOf", tarball, `package/${member}`], {
      maxBuffer: 256 * 1024 * 1024,
    });
    digest.set(member, createHash("sha256").update(bytes).digest("hex"));
  }
  return digest;
};

const staging = mkdtempSync(join(tmpdir(), "gonogo-published-"));
try {
  try {
    execFileSync(
      "npm",
      ["pack", `${name}@${version}`, "--pack-destination", staging],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
  } catch {
    console.log(`${name}@${version} is not on npm: publish it.`);
    process.exit(3);
  }

  const published = distDigest(
    join(
      staging,
      execFileSync("ls", [staging], { encoding: "utf8" }).trim().split("\n")[0],
    ),
  );
  const local = distDigest(packed);

  const differences = [];
  for (const [member, hash] of local) {
    if (!published.has(member)) differences.push(`+ ${member} (new)`);
    else if (published.get(member) !== hash)
      differences.push(`~ ${member} (changed)`);
  }
  for (const member of published.keys()) {
    if (!local.has(member)) differences.push(`- ${member} (removed)`);
  }

  if (differences.length === 0) {
    console.log(
      `${name}@${version} on npm matches what this tree builds (${local.size} dist files): skipping is safe.`,
    );
    process.exit(0);
  }

  console.error(
    `\n${name}@${version} is ALREADY PUBLISHED, but its published contents do not match ` +
      `this tree:\n` +
      `${differences
        .slice(0, 25)
        .map((d) => `  ${d}`)
        .join("\n")}\n` +
      (differences.length > 25
        ? `  ... and ${differences.length - 25} more\n`
        : "") +
      `\nSkipping here would leave the registry copy a fossil, which is how the sdk stayed ` +
      `at its first-ever publish while the workspace surface grew past it. Bump the version ` +
      `in the package's manifest and re-run.\n`,
  );
  process.exit(1);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
