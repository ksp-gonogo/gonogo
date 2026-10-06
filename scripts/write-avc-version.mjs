#!/usr/bin/env node
/**
 * Writes the KSP-AVC `.version` file CKAN reads for a mod's game-version
 * compatibility (`$vref: #/ckan/ksp-avc`).
 *
 * Usage: node scripts/write-avc-version.mjs <out-file> <display-name> <version>
 *
 * `<version>` is a release tag (`v1.4.0`) or an rc label (`rc-abc1234`). A tag
 * is split into MAJOR/MINOR/PATCH; anything else is written as 0.0.0, since
 * an rc is never indexed and CKAN takes its own version from the release.
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
  const m = /^[vV]?(\d+)\.(\d+)\.(\d+)/.exec(version);
  const [major, minor, patch] = m ? [m[1], m[2], m[3]].map(Number) : [0, 0, 0];
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
