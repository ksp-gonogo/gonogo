#!/usr/bin/env node
/**
 * The one rule for which version a mod zip may reach players with:
 *
 *   mod-release-tag.mjs assert <tag>      exits 1 unless <tag> is a release
 *
 * A release is `v<MAJOR>.<MINOR>.<PATCH>` and nothing more. A version with a
 * prerelease part (`v0.2.0-rc.1`), a build part (`v0.2.0+7`) or no `v` at all
 * is not one. SpaceDock feeds CKAN and a player who ticks Upgrade All takes
 * whatever CKAN lists newest, so a candidate that reaches SpaceDock or the
 * GitHub release's mod asset is installed on real saves.
 *
 * The SpaceDock upload and the release attach each ask this themselves, so
 * the rule holds even if the version job upstream of them is edited.
 */
export const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

export function isReleaseTag(tag) {
  return RELEASE_TAG.test(tag);
}

export function main(argv) {
  const [command, tag] = argv;
  if (command !== "assert" || argv.length !== 2) {
    console.error("usage: mod-release-tag.mjs assert <tag>");
    return 2;
  }
  if (!isReleaseTag(tag)) {
    console.error(
      `'${tag}' is not a release version (v<MAJOR>.<MINOR>.<PATCH>): a mod zip for it must not reach SpaceDock or the GitHub release`,
    );
    return 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
