/**
 * `uplink-tools bake`: what an Uplink's plugin says about its client, written as
 * the three generated C# files the plugin's `UplinkManifest` reads.
 *
 * The app carries no list of Uplink ids. It learns that an Uplink has a client,
 * where the bundle lives and what it should hash to from the roster the mod
 * publishes, and the roster is filled from `UplinkManifest`. A plugin that says
 * nothing there is installed and invisible.
 *
 * `Url` and `DevPath` are different kinds of value. `Url` is where the released
 * bundle lives for everyone, so it is declared in `uplink.json` and ships.
 * `DevPath` is the author's own machine for one afternoon. The loader prefers it
 * when present, which is right for a dev loop and wrong to ship, so it comes only
 * from `--dev-path` or `GONOGO_UPLINK_DEV_PATH` and a bake that was given one says
 * so loudly.
 *
 * The hash has to be of the bundle that ships, so the order is bundle, bake, then
 * compile the plugin. Baked without a bundle the hash is empty, and the app
 * refuses an outside client whose plugin vouches for none.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseFlags } from "./flags";

export const BAKE_USAGE = `uplink-tools bake [options]

  Write what the plugin tells the app about its client into generated C#:
  mod/Provenance.g.cs, mod/ClientSource.g.cs and mod/ExpectedClientHash.g.cs,
  from uplink.json and client/package.json. Run it from anywhere inside the
  Uplink. The plugin does not compile without the three files.

  The app loads an installed Uplink's client only when its plugin vouches for
  the bundle's hash, so a release is: bundle, bake --bundle, then build the mod.

  --bundle <file>    the built client bundle to hash. Without it the hash is
                     baked empty: the plugin builds and its tests run, and the
                     app refuses its client
  --dev-path <url>   where a dev server serves the bundle. The loader prefers
                     it over the released URL, so never release a DLL baked
                     with one (also read from GONOGO_UPLINK_DEV_PATH)
  --uplink <dir>     the Uplink's directory, the one holding uplink.json
                     (default: found by walking up from the current directory)`;

export interface BakeInputs {
  /** The directory holding `uplink.json`. */
  uplinkDir: string;
  /** The built client bundle to hash, or `undefined` to bake an empty hash. */
  bundle?: string;
  /** A dev server URL for the bundle, or empty for the release shape. */
  devPath?: string;
}

export interface BakeResult {
  id: string;
  written: string[];
  url: string | undefined;
  hash: string;
  devPath: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** A C# string literal. JSON's escapes are a subset of C#'s. */
const cs = (literal: string): string => JSON.stringify(literal);

/** The nearest directory at or above `from` that holds an `uplink.json`. */
export function findUplinkDir(from: string): string | undefined {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "uplink.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function readJson(path: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(readFileSync(path, "utf8")));
  } catch (err) {
    throw new Error(
      `${path} is not readable JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function bakeUplink(inputs: BakeInputs): BakeResult {
  const uplinkDir = resolve(inputs.uplinkDir);
  const declaredPath = join(uplinkDir, "uplink.json");
  if (!existsSync(declaredPath)) {
    throw new Error(
      `${uplinkDir} holds no uplink.json, so it is not an Uplink`,
    );
  }
  const declared = readJson(declaredPath);
  const id = text(declared.id);
  if (!id) throw new Error(`${declaredPath} declares no id`);

  const namespace = text(declared.csharpNamespace);
  if (!namespace) {
    throw new Error(
      `${declaredPath} declares no "csharpNamespace", so bake cannot know which namespace to ` +
        "write. It is read rather than derived from the id, because the two do not match in general.",
    );
  }

  const modDir = join(uplinkDir, "mod");
  if (!existsSync(modDir)) {
    throw new Error(
      `${modDir} does not exist. The generated files are compiled into the plugin, which lives there.`,
    );
  }

  // An Uplink with no client half has no client package to take a version from, and its plugin states its own.
  const pkgPath = join(uplinkDir, "client", "package.json");
  const version = existsSync(pkgPath) ? text(readJson(pkgPath).version) : "";
  if (!version && existsSync(join(uplinkDir, "client"))) {
    throw new Error(
      `${pkgPath} carries no version. An Uplink has one version for both halves, and the ` +
        "client's package.json is where it is written.",
    );
  }

  const devPath = inputs.devPath ?? "";
  let hash = "";
  if (inputs.bundle !== undefined) {
    const bundlePath = resolve(inputs.bundle);
    if (!existsSync(bundlePath)) {
      throw new Error(
        `${bundlePath} does not exist. Hashing a bundle that was never built would bake a value ` +
          "the loader can never match, which fails as tampering rather than as a bad build. " +
          "Run `uplink-tools bundle` first.",
      );
    }
    hash = `sha256-${createHash("sha256").update(readFileSync(bundlePath)).digest("hex")}`;
  }

  const header =
    "// <auto-generated> Written by `uplink-tools bake`. DO NOT EDIT.";
  const written: string[] = [];
  const write = (file: string, body: string) => {
    const path = join(modDir, file);
    writeFileSync(path, `${header}\n${body}`);
    written.push(path);
  };

  write(
    "Provenance.g.cs",
    `//
// Who wrote this Uplink and which version it is, from uplink.json and
// client/package.json. The app shows it when it asks the operator whether to
// load the client.
namespace ${namespace}
{
    internal static class Provenance
    {
        public const string Name = ${cs(text(declared.name))};
        public const string Author = ${cs(text(declared.author))};
        public const string Repo = ${cs(text(declared.repo))};
        public const string Version = ${cs(version)};
    }
}
`,
  );

  // A mod-only Uplink has no client to point at, and an empty URL is not the same statement as none.
  const url = text(asRecord(declared.client).url) || undefined;
  if (url === undefined) {
    return { id, written, url, hash: "", devPath: "" };
  }

  write(
    "ClientSource.g.cs",
    `//
// Url comes from uplink.json and ships. DevPath comes from the bake that wrote
// this file and must not: the loader prefers DevPath when it is non-empty, so a
// released DLL carrying one sends every user to a machine that is not theirs.
namespace ${namespace}
{
    internal static class ClientSource
    {
        public const string Url = ${cs(url)};
        public const string DevPath = ${cs(devPath)};
    }
}
`,
  );

  write(
    "ExpectedClientHash.g.cs",
    `//
// The sha256 of the client bundle this DLL was built alongside. Empty when it
// was baked without a bundle, which leaves UplinkManifest.ExpectedClientHash
// null, and the app refuses an outside client whose plugin vouches for no hash.
namespace ${namespace}
{
    internal static class ExpectedClientHash
    {
        public const string Value = ${cs(hash)};
    }
}
`,
  );

  return { id, written, url, hash, devPath };
}

/** What a bake did, in the words an author needs before deciding to ship the DLL. */
export function describeBake(result: BakeResult): string {
  const lines = [
    `${result.id}: baked ${result.written.length} files into mod/`,
  ];
  if (result.url === undefined) {
    lines.push(
      "  no client.url in uplink.json, so the plugin announces no client (a mod-only Uplink)",
    );
    return lines.join("\n");
  }
  lines.push(`  Url      ${result.url}`);
  if (result.devPath) {
    lines.push(
      `  DevPath  ${result.devPath}`,
      "  DEV BUILD. The loader prefers DevPath over Url, so a DLL compiled now sends every",
      "  client to that address. Bake again without --dev-path before releasing.",
    );
  }
  lines.push(
    result.hash
      ? `  Hash     ${result.hash}`
      : "  Hash     (none) The plugin builds and its tests run, but the app refuses the client of a\n" +
          "           plugin that vouches for no hash. Before installing it: bundle, then bake --bundle <file>.",
  );
  return lines.join("\n");
}

export function bake(
  argv: readonly string[],
  cwd: string = process.cwd(),
): number {
  const { values } = parseFlags(argv, {
    verb: "bake",
    usage: BAKE_USAGE,
    values: ["--bundle", "--dev-path", "--uplink"],
  });
  const named = values.get("--uplink");
  const uplinkDir = named ? resolve(cwd, named) : findUplinkDir(cwd);
  if (!uplinkDir) {
    throw new Error(
      `no uplink.json in ${cwd} or any directory above it. Run bake inside an Uplink, or name ` +
        "one with --uplink <dir>.",
    );
  }
  const bundle = values.get("--bundle");
  const result = bakeUplink({
    uplinkDir,
    bundle: bundle === undefined ? undefined : resolve(cwd, bundle),
    devPath: values.get("--dev-path") ?? process.env.GONOGO_UPLINK_DEV_PATH,
  });
  console.log(describeBake(result));
  return 0;
}
