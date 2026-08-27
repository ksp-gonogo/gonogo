import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TARGETS_FILE = resolve(
  import.meta.dirname,
  "../../uplink-bundle-targets.ts",
);

/**
 * The ids of the Uplink clients this repo builds runtime-loadable bundles for,
 * read out of the build's own `UPLINK_BUNDLE_TARGETS`.
 *
 * Read textually rather than imported because that file sits outside the app's
 * `rootDir` (deliberately: the shipped app must not carry a first-party id
 * list, `noBakedUplinkIds.test.ts`). Same trick `vite.config.ts` already uses
 * to read the SDK's contract-version consts across a package boundary.
 *
 * Throws on an empty parse. A checker whose input list silently emptied would
 * report a clean pass while checking nothing.
 */
export function firstPartyUplinkIds(): string[] {
  const source = readFileSync(TARGETS_FILE, "utf8");
  const ids = [...source.matchAll(/^\s*id:\s*"([^"]+)"/gm)].map(
    (m) => m[1] as string,
  );
  if (ids.length === 0) {
    throw new Error(`no target ids parsed out of ${TARGETS_FILE}`);
  }
  return ids;
}
