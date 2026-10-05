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

const KSP_VERSION = "1.12.3";
const KSP_VERSION_MIN = "1.12.0";
const KSP_VERSION_MAX = "1.12.99";

export function avcVersion(name, version) {
  const m = /^[vV]?(\d+)\.(\d+)\.(\d+)/.exec(version);
  const [major, minor, patch] = m ? [m[1], m[2], m[3]].map(Number) : [0, 0, 0];
  return {
    NAME: name,
    VERSION: { MAJOR: major, MINOR: minor, PATCH: patch },
    KSP_VERSION,
    KSP_VERSION_MIN,
    KSP_VERSION_MAX,
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
