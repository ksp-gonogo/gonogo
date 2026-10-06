#!/usr/bin/env node
/**
 * What the SpaceDock upload needs to decide before it POSTs.
 *
 *   spacedock-release.mjs bare-version <tag>            prints the version SpaceDock gets
 *   spacedock-release.mjs holds <listing.json> <version> prints `held` or `absent`
 *
 * SpaceDock feeds CKAN, which takes its version straight from the SpaceDock
 * version string. CKAN orders a leading `v` as a non-digit run before the
 * digits, so one `v0.2.0` among bare numbers would outrank every bare
 * version after it, forever. The listing therefore only ever holds bare
 * versions, whatever the tag looks like.
 *
 * Exit 2 on anything unreadable: a failed lookup must stop the upload, because
 * treating "could not read the listing" as "version absent" is how a rerun
 * uploads a version twice.
 */
import { readFileSync } from "node:fs";

/** The tag without its leading `v`. */
export function bareVersion(tag) {
  return tag.replace(/^[vV]/, "");
}

/** Whether a public `GET /api/mod/<id>` reply already lists `version`. */
export function listingHolds(listing, version) {
  if (!listing || !Array.isArray(listing.versions)) {
    throw new Error(
      `the SpaceDock reply carries no versions list: ${JSON.stringify(listing).slice(0, 200)}`,
    );
  }
  return listing.versions.some((v) => v.friendly_version === version);
}

export function main(argv) {
  const [command, ...rest] = argv;
  if (command === "bare-version" && rest.length === 1) {
    console.log(bareVersion(rest[0]));
    return 0;
  }
  if (command === "holds" && rest.length === 2) {
    const listing = JSON.parse(readFileSync(rest[0], "utf8"));
    console.log(listingHolds(listing, rest[1]) ? "held" : "absent");
    return 0;
  }
  console.error(
    "usage: spacedock-release.mjs bare-version <tag> | holds <listing.json> <version>",
  );
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
