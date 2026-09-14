import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const TARGETS_FILE = resolve(
  import.meta.dirname,
  "../../uplink-bundle-targets.ts",
);

const MOD_DIR = resolve(import.meta.dirname, "../../../../mod");

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

/**
 * The client directory of every Uplink this repo builds a runtime-loadable
 * bundle for, matched from the build's own target ids to the `Gonogo<Mod>Uplink`
 * directory naming each one.
 *
 * Derived rather than listed because a hardcoded id -> directory table would put
 * mod names in `src/`, which the mod-ownership boundary guard exists to stop.
 * The ids come from `uplink-bundle-targets.ts`, the list the build itself
 * resolves these same entry points from, and the directory names come off disk.
 * A descriptor id would be tidier but not every loader client ships a
 * `gonogo-uplink.json`, so keying on one silently drops a client, and a dropped
 * client is a check that passes while covering less than it claims.
 *
 * Ambiguity throws rather than picking: two directories matching one id means
 * the naming assumption has stopped holding.
 */
export function firstPartyUplinkClientDirs(): { id: string; dir: string }[] {
  const uplinkDirs = readdirSync(MOD_DIR).filter((entry) =>
    /^Gonogo.*Uplink$/.test(entry),
  );
  return firstPartyUplinkIds().map((id) => {
    const matches = uplinkDirs.filter(
      (entry) =>
        entry.toLowerCase().includes(id.toLowerCase()) &&
        existsSync(join(MOD_DIR, entry, "client", "src", "index.ts")),
    );
    if (matches.length !== 1) {
      throw new Error(
        `expected exactly one Uplink client directory for "${id}", found ${matches.length}: ${matches.join(", ")}`,
      );
    }
    return { id, dir: join(MOD_DIR, matches[0] as string, "client") };
  });
}

/**
 * `mod/<dir>/client` for every Uplink client manifest git tracks, repo-relative
 * and sorted: the independent list {@link firstPartyUplinkClientDirs} is held to,
 * so a client the build stopped targeting cannot drop out of a gate unnoticed.
 */
export function trackedUplinkClientDirs(): string[] {
  const repoRoot = resolve(MOD_DIR, "..");
  return execFileSync("git", ["ls-files", "mod/*/client/package.json"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .map((rel) => /^(mod\/Gonogo[^/]*Uplink\/client)\/package\.json$/.exec(rel))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1] as string)
    .sort();
}

/** {@link firstPartyUplinkClientDirs}, repo-relative in the same form. */
export function firstPartyUplinkClientRelDirs(): string[] {
  const repoRoot = resolve(MOD_DIR, "..");
  return firstPartyUplinkClientDirs()
    .map(({ dir }) => relative(repoRoot, dir).split("\\").join("/"))
    .sort();
}

/**
 * Imports every first-party Uplink client from source, so each runs its
 * module-load registrations the way the app's bundle loader would. Returns the
 * ids imported.
 *
 * From `src/index.ts` rather than by package name: the app's dependency on a
 * client leaves with that client, and a source import needs no prior build.
 */
export async function importFirstPartyUplinkClients(): Promise<string[]> {
  const clients = firstPartyUplinkClientDirs();
  for (const { dir } of clients) {
    await import(/* @vite-ignore */ join(dir, "src", "index.ts"));
  }
  return clients.map(({ id }) => id);
}
