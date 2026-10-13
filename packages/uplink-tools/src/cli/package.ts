/**
 * `uplink-tools package`: the mod half as a GameData tree and the zip of it.
 *
 * The zip holds the plugin and its own contract slice and nothing else of
 * Gonogo's: `Sitrep.Contract.dll` is GonogoCore's to provide, and a second copy
 * in another GameData folder is a second set of types that do not compare equal
 * to the first.
 *
 * Its one root is `GameData/<name>/`, which is what both ways of installing a
 * mod expect: by hand the zip is unpacked over the game's own folder, and CKAN
 * copies the path the netkan's install stanza names. The netkan is held to the
 * zip here, because a stanza naming a path the zip does not hold installs
 * nothing and reports no error.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { findUplinkDir } from "./bake";
import { parseFlags } from "./flags";
import { type ZipEntry, zipArchive } from "./zip";

export const PACKAGE_USAGE = `uplink-tools package [options]

  Lay the built plugin out as GameData/<name>/ and zip it with that as the
  zip's one root, with the netkan beside the zip. It refuses a netkan whose
  install stanza names a path the zip does not hold. Build the mod in Release
  first; release does both in order.

  --out <dir>      where the zip goes (default: dist/ in the Uplink)
  --uplink <dir>   the Uplink's directory, the one holding uplink.json
                   (default: found by walking up from the current directory)`;

export interface PackageResult {
  id: string;
  zip: string;
  files: string[];
}

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

export function packageMod(uplinkDir: string, outDir: string): PackageResult {
  const declared: unknown = JSON.parse(
    readFileSync(join(uplinkDir, "uplink.json"), "utf8"),
  );
  const field = (key: string) =>
    text(
      typeof declared === "object" && declared !== null
        ? Reflect.get(declared, key)
        : undefined,
    );
  const id = field("id");
  const gamedata = field("gamedata");
  const dll = field("dll");
  if (!gamedata || !dll) {
    throw new Error(
      `${join(uplinkDir, "uplink.json")} must declare "gamedata" (the GameData folder's name) and ` +
        '"dll" (the plugin assembly), or there is nothing to name the package after.',
    );
  }

  const modDir = join(uplinkDir, "mod");
  const modBin = join(modDir, "bin", "Release");
  const required = [dll];
  if (existsSync(join(uplinkDir, "mod-contract"))) {
    required.push(dll.replace(/\.dll$/, ".Contract.dll"));
  }
  const missing = required.filter((file) => !existsSync(join(modBin, file)));
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(", ")} absent from ${modBin}. Nothing to package: build the mod in Release ` +
        "first. An empty or partial zip installs cleanly and then does nothing in game.",
    );
  }

  const staging = join(outDir, "gamedata", gamedata);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, "Plugins"), { recursive: true });
  const files: string[] = [];
  for (const file of required) {
    cpSync(join(modBin, file), join(staging, "Plugins", file));
    files.push(`Plugins/${file}`);
  }
  // A licence and any notices ride along by their shape, since which ones an Uplink owes depends on the mod it wraps.
  for (const extra of readdirSync(modDir).sort()) {
    if (extra !== "LICENSE" && !/^NOTICE.*\.txt$/i.test(extra)) continue;
    cpSync(join(modDir, extra), join(staging, extra));
    files.push(extra);
  }

  const entries: ZipEntry[] = files.sort().map((file) => ({
    path: `GameData/${gamedata}/${file}`,
    bytes: readFileSync(join(staging, file)),
  }));

  const netkan = join(modDir, `${gamedata}.netkan`);
  if (existsSync(netkan)) {
    const unmet = netkanInstallsMissingFrom(
      netkan,
      entries.map((entry) => entry.path),
    );
    if (unmet.length > 0) {
      throw new Error(
        `${netkan} installs ${unmet.join(" and ")}, and the mod zip holds no such path: its one root ` +
          `is GameData/${gamedata}/. CKAN would install nothing. Make the install stanza ` +
          `{ "file": "GameData/${gamedata}", "install_to": "GameData" }.`,
      );
    }
    cpSync(netkan, join(outDir, `${gamedata}.netkan`));
  }
  const zip = join(outDir, `${gamedata}.zip`);
  writeFileSync(zip, zipArchive(entries));
  return { id, zip, files };
}

/**
 * The paths a netkan's install stanzas name that the zip does not hold. A
 * `file` is a path from the zip's root; a `find` is a folder name anywhere in
 * it. A stanza using anything else (`find_regexp`) is not judged.
 */
function netkanInstallsMissingFrom(
  netkanPath: string,
  zipPaths: readonly string[],
): string[] {
  const parsed: unknown = JSON.parse(readFileSync(netkanPath, "utf8"));
  const install: unknown =
    typeof parsed === "object" && parsed !== null
      ? Reflect.get(parsed, "install")
      : undefined;
  const stanzas: unknown[] = Array.isArray(install) ? install : [];
  const folders = new Set(
    zipPaths.flatMap((path) => {
      const parts = path.split("/").slice(0, -1);
      return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
    }),
  );
  const missing: string[] = [];
  for (const stanza of stanzas) {
    if (typeof stanza !== "object" || stanza === null) continue;
    const file: unknown = Reflect.get(stanza, "file");
    const find: unknown = Reflect.get(stanza, "find");
    if (typeof file === "string" && !folders.has(file.replace(/\/+$/, ""))) {
      missing.push(`"file": "${file}"`);
    }
    if (
      typeof find === "string" &&
      ![...folders].some((folder) => folder.split("/").pop() === find)
    ) {
      missing.push(`"find": "${find}"`);
    }
  }
  return missing;
}

export function packageCommand(
  argv: readonly string[],
  cwd: string = process.cwd(),
): number {
  const { values } = parseFlags(argv, {
    verb: "package",
    usage: PACKAGE_USAGE,
    values: ["--out", "--uplink"],
  });
  const named = values.get("--uplink");
  const uplinkDir = named ? resolve(cwd, named) : findUplinkDir(cwd);
  if (!uplinkDir) {
    throw new Error(
      `no uplink.json in ${cwd} or any directory above it. Run package inside an Uplink, or name ` +
        "one with --uplink <dir>.",
    );
  }
  const out = values.get("--out");
  const result = packageMod(
    uplinkDir,
    out === undefined ? join(uplinkDir, "dist") : resolve(cwd, out),
  );
  console.log(`${result.id}: ${result.zip}`);
  for (const file of result.files) console.log(`  ${file}`);
  return 0;
}
