/**
 * `uplink-tools package`: the mod half as a GameData tree and the zip of it.
 *
 * The zip holds the plugin and its own contract slice and nothing else of
 * Gonogo's: `Sitrep.Contract.dll` is GonogoCore's to provide, and a second copy
 * in another GameData folder is a second set of types that do not compare equal
 * to the first.
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

  Lay the built plugin out as GameData/<name>/ and zip it, with the netkan
  beside the zip. Build the mod in Release first; release does both in order.

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

  const netkan = join(modDir, `${gamedata}.netkan`);
  if (existsSync(netkan)) cpSync(netkan, join(outDir, `${gamedata}.netkan`));

  const entries: ZipEntry[] = files.sort().map((file) => ({
    path: `${gamedata}/${file}`,
    bytes: readFileSync(join(staging, file)),
  }));
  const zip = join(outDir, `${gamedata}.zip`);
  writeFileSync(zip, zipArchive(entries));
  return { id, zip, files };
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
