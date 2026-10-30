import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJsonFile } from "./report";
import { isPrerelease, plainVersion } from "./version";

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Every pin of an Uplink that names a prerelease, as a sentence saying where it
 * is written: the version of the mod it was built against, the version CKAN
 * lists it under, a `ckanDepends` minimum, and the packages that move with the
 * mod. Useful for keeping a candidate out of a pin on `main` and out of a
 * release's CKAN relationship. Used by `check` and `release`.
 */
export function prereleasePins(uplinkDir: string): string[] {
  const file = join(uplinkDir, "uplink.json");
  if (!existsSync(file)) return [];
  const uplink = readJsonFile(file);
  const mod = asRecord(uplink.mod);
  const found: string[] = [];
  const test = (where: string, value: unknown) => {
    if (typeof value === "string" && isPrerelease(plainVersion(value))) {
      found.push(`${where} is ${value}`);
    }
  };
  test("uplink.json mod.builtAgainst", mod.builtAgainst);
  test("uplink.json mod.ckanVersion", mod.ckanVersion);
  const depends = Array.isArray(uplink.ckanDepends) ? uplink.ckanDepends : [];
  for (const entry of depends) {
    const record = asRecord(entry);
    test(
      `uplink.json ckanDepends ${String(record.name)} min_version`,
      record.min_version,
    );
  }
  const manifestFile = join(uplinkDir, "client", "package.json");
  if (existsSync(manifestFile) && Array.isArray(mod.packages)) {
    const manifest = readJsonFile(manifestFile);
    for (const name of mod.packages) {
      for (const block of ["dependencies", "devDependencies"]) {
        const range = asRecord(manifest[block])[String(name)];
        test(`client/package.json ${String(name)}`, range);
      }
    }
  }
  return found;
}

/**
 * The sentence a release refuses with when a pin is a prerelease, or undefined.
 * A candidate, an Uplink whose own `version` is a prerelease, may pin one: it
 * is never listed on CKAN, so no relationship is published from its pins.
 */
export function prereleasePinFault(
  uplinkDir: string,
  version: string,
): string | undefined {
  if (isPrerelease(plainVersion(version))) return undefined;
  const pins = prereleasePins(uplinkDir);
  if (pins.length === 0) return undefined;
  return (
    `${pins.join("; ")}. A prerelease is never a pin in a release: its version sorts above the ` +
    "release it is for in CKAN's ordering, so a relationship on it would refuse the real release. " +
    "Pin the release, release this as a candidate, or run `uplink-tools deps bump`."
  );
}

/** Whether the working tree is on `main`, the branch a prerelease pin must never reach. */
export function onMain(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const named = env.GITHUB_BASE_REF || env.GITHUB_REF_NAME;
  if (named) return named === "main";
  const ran = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  return ran.status === 0 && ran.stdout.trim() === "main";
}
