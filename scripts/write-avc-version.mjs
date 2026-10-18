#!/usr/bin/env node
/**
 * Writes the KSP-AVC `.version` file CKAN reads for a mod's game-version
 * compatibility (`$vref: #/ckan/ksp-avc`).
 *
 * Usage: node scripts/write-avc-version.mjs <out-file> <display-name> <version>
 *
 * `<version>` is a release tag (`v1.4.0`) or a candidate label
 * (`1.4.0-rc.41`, `1.4.0-dev.abc1234`). It is split into MAJOR/MINOR/PATCH of
 * the base release, since KSP-AVC has no prerelease field. Anything else is
 * refused.
 */
import { writeFileSync } from "node:fs";

/**
 * The game versions every mod zip declares: the one `.version` file CKAN reads
 * and the SpaceDock game-version field, which the publish workflow reads back
 * out of the written file. The only place a game version is written down.
 */
export const GAME_VERSIONS = {
  KSP_VERSION: "1.12.5",
  KSP_VERSION_MIN: "1.12.0",
  KSP_VERSION_MAX: "1.12.99",
};

/** KSP-AVC's object form of a dotted game version. */
function versionObject(dotted) {
  const [MAJOR, MINOR, PATCH] = dotted.split(".").map(Number);
  return { MAJOR, MINOR, PATCH };
}

export function avcVersion(name, version) {
  const m = /^[vV]?(\d+)\.(\d+)\.(\d+)(?:-(?:rc\.\d+|dev\.[0-9a-f]{7}))?$/.exec(
    version,
  );
  if (!m) {
    throw new Error(
      `version must be vX.Y.Z, X.Y.Z-rc.N or X.Y.Z-dev.<sha7>, got '${version}'`,
    );
  }
  const [major, minor, patch] = [m[1], m[2], m[3]].map(Number);
  return {
    NAME: name,
    VERSION: { MAJOR: major, MINOR: minor, PATCH: patch },
    ...Object.fromEntries(
      Object.entries(GAME_VERSIONS).map(([key, dotted]) => [
        key,
        versionObject(dotted),
      ]),
    ),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [out, name, version] = process.argv.slice(2);
  if (!out || !name || !version) {
    console.error(
      "usage: write-avc-version.mjs <out-file> <display-name> <version>",
    );
    process.exit(2);
  }
  writeFileSync(out, `${JSON.stringify(avcVersion(name, version), null, 2)}\n`);
}
