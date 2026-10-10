/**
 * `uplink-tools release`: both halves of an Uplink, built in the one order that
 * works.
 *
 * The plugin vouches for its client by hash, and the app refuses an outside
 * client whose plugin vouches for none. So the bundle has to exist and be
 * hashed before the plugin is compiled, and the compiled plugin has to be the
 * one that is packaged. Run by hand that is four commands in an order nothing
 * enforces; this is the order.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bakeUplink, describeBake, findUplinkDir } from "./bake";
import { dotnet } from "./codegen";
import { parseFlags } from "./flags";
import { packageMod } from "./package";

export const RELEASE_USAGE = `uplink-tools release [options]

  Build both halves for release: bundle the client, bake its hash into the
  plugin's sources, compile the plugin in Release, check the compiled DLL
  carries what was baked, and zip the GameData tree. Needs the .NET SDK.

  An Uplink has one version and it is written in three places: client/package.json,
  defineUplinkClient's version, and the version folder in uplink.json's
  client.url. release refuses when they disagree.

  The client lands in client/dist/<id>/ and the mod zip in dist/, or both
  under --out: <out>/<id>/ for the client and <out>/ for the zip.

  --dev-path <url>      bake a dev server URL for the bundle. The loader prefers
                        it over the released URL, so the result is a dev build
                        and is not zipped
  --allow-dev-package   zip a dev build anyway, to hand to one machine
  --out <dir>           one folder for both: the client in <dir>/<id>/, the
                        mod zip in <dir>/
  --uplink <dir>        the Uplink's directory, the one holding uplink.json
                        (default: found by walking up from the current directory)`;

/**
 * The GitHub owner \`new\` writes when it was told no repository. A URL under it serves nothing.
 * It is a name nobody types as their own, so a repository an author names is never mistaken for it.
 */
export const PLACEHOLDER_OWNER = "your-github-owner";

const isPlaceholderUrl = (url: string): boolean =>
  url.includes(`/gh/${PLACEHOLDER_OWNER}/`);

/** Why a client URL cannot be released, or nothing when it is a real address. */
export function placeholderUrlFault(url: string): string | undefined {
  if (!url || !isPlaceholderUrl(url)) return undefined;
  return (
    `uplink.json's client.url is still the placeholder (${url}). A released plugin tells ` +
    "every install to fetch its client from there, and nothing is served there. Set " +
    '"repo" and "client.url" to where the bundle will really be published, then release.'
  );
}

/**
 * The versions written in a URL's path, such as the `0.0.1` folder a release is
 * published under or the `v0.0.1` of a tag. The host is not read, so an address
 * of four numbers is never taken for one.
 */
export function versionsInUrlPath(url: string): string[] {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not a URL the platform parses: read it whole.
  }
  return (
    path.match(/(?<![\d.])\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?(?![\d.]*\d)/g) ?? []
  );
}

/** Why a client URL cannot be released at this version, or nothing. A URL that names no version is not judged. */
export function urlVersionFault(
  url: string,
  version: string,
): string | undefined {
  const named = versionsInUrlPath(url);
  if (!version || named.length === 0 || named.includes(version)) {
    return undefined;
  }
  return (
    `uplink.json's client.url is for version ${named.join(" and ")} (${url}), and ` +
    `client/package.json says this is ${version}. The plugin would send every install to ` +
    "the other release's bundle, whose hash it does not vouch for, and the app would " +
    "refuse it. Move the version in client.url with the one in package.json."
  );
}

/** Why the built client's own version cannot be released beside package.json's, or nothing. */
export function declaredVersionFault(
  declared: string,
  version: string,
  manifestFile: string,
): string | undefined {
  if (!declared || declared === version) return undefined;
  return (
    `the client declares version ${declared} (defineUplinkClient, written to ` +
    `${manifestFile}) and client/package.json says ${version}. The app shows the first ` +
    "and the plugin is stamped with the second, so one release would carry two " +
    "versions. Make them the same, then release."
  );
}

export async function release(
  argv: readonly string[],
  bundle: (argv: readonly string[]) => Promise<number>,
  cwd: string = process.cwd(),
): Promise<number> {
  const { values, switches } = parseFlags(argv, {
    verb: "release",
    usage: RELEASE_USAGE,
    values: ["--dev-path", "--out", "--uplink"],
    switches: ["--allow-dev-package"],
  });
  const named = values.get("--uplink");
  const uplinkDir = named ? resolve(cwd, named) : findUplinkDir(cwd);
  if (!uplinkDir) {
    throw new Error(
      `no uplink.json in ${cwd} or any directory above it. Run release inside an Uplink, or name ` +
        "one with --uplink <dir>.",
    );
  }
  const declared: unknown = JSON.parse(
    readFileSync(join(uplinkDir, "uplink.json"), "utf8"),
  );
  const field = (from: unknown, key: string): unknown =>
    typeof from === "object" && from !== null
      ? Reflect.get(from, key)
      : undefined;
  const str = (value: unknown): string =>
    typeof value === "string" ? value : "";
  const id = str(field(declared, "id"));
  const gamedata = str(field(declared, "gamedata"));
  const dllName = str(field(declared, "dll"));
  const url = str(field(field(declared, "client"), "url"));
  const devPath = values.get("--dev-path") ?? "";
  const outValue = values.get("--out");
  const outDir =
    outValue === undefined ? join(uplinkDir, "dist") : resolve(cwd, outValue);
  const project = join(uplinkDir, "mod", `${gamedata}.csproj`);
  if (!id || !gamedata || !dllName || !existsSync(project)) {
    throw new Error(
      `${join(uplinkDir, "uplink.json")} must declare "id", "gamedata" and "dll", and ` +
        `mod/<gamedata>.csproj must exist (looked for ${project}).`,
    );
  }

  const placeholder = devPath ? undefined : placeholderUrlFault(url);
  if (placeholder) throw new Error(placeholder);

  const clientDir = join(uplinkDir, "client");
  const versionFile = join(clientDir, "package.json");
  const version = existsSync(versionFile)
    ? str(field(JSON.parse(readFileSync(versionFile, "utf8")), "version"))
    : "";
  const wrongUrl = url && !devPath ? urlVersionFault(url, version) : undefined;
  if (wrongUrl) throw new Error(wrongUrl);

  const step = (label: string) => console.log(`\n== ${label}`);
  let bundlePath: string | undefined;
  if (url) {
    step("bundle the client");
    const code = await bundle([
      "--client",
      clientDir,
      ...(outValue === undefined ? [] : ["--out", outDir]),
    ]);
    if (code !== 0) return code;
    const bundleDir = join(
      outValue === undefined ? join(clientDir, "dist") : outDir,
      id,
    );
    bundlePath = join(bundleDir, `${id}.client.js`);
    const manifestFile = join(bundleDir, "gonogo-uplink.json");
    const declaredVersion = existsSync(manifestFile)
      ? str(field(JSON.parse(readFileSync(manifestFile, "utf8")), "version"))
      : "";
    const twoVersions = declaredVersionFault(
      declaredVersion,
      version,
      manifestFile,
    );
    if (twoVersions) throw new Error(twoVersions);
  }

  step("bake what the plugin says about its client");
  const baked = bakeUplink({ uplinkDir, bundle: bundlePath, devPath });
  console.log(describeBake(baked));

  step("compile the plugin");
  dotnet("compile the plugin", [
    "build",
    project,
    "-c",
    "Release",
    "--nologo",
    "-v",
    "quiet",
    "-clp:ErrorsOnly",
  ]);

  // The generated C# being on disk does not mean it reached the assembly: a stale obj/ or a compile set that misses mod/*.g.cs builds green without it.
  const dll = join(uplinkDir, "mod", "bin", "Release", dllName);
  if (!existsSync(dll)) {
    throw new Error(
      `the build succeeded and ${dll} does not exist. uplink.json's "dll" must be the plugin's ` +
        "assembly file name.",
    );
  }
  if (url) {
    const compiled = readFileSync(dll);
    const expected: [string, string][] = [
      ["the client URL", url],
      ["the bundle's hash", baked.hash],
    ];
    if (devPath) expected.push(["the dev path", devPath]);
    const absent = expected.filter(
      ([, value]) => !compiled.includes(Buffer.from(value, "utf16le")),
    );
    if (absent.length > 0) {
      throw new Error(
        `${dllName} does not contain ${absent.map(([what]) => what).join(" or ")}, which bake ` +
          "wrote. Check that mod/*.g.cs is compiled into the plugin and that its manifest reads " +
          "them. Refusing to package a plugin that does not vouch for its own client.",
      );
    }
    console.log(
      `  ${dllName} carries ${expected.map(([what]) => what).join(", ")}`,
    );
  }

  if (devPath && !switches.has("--allow-dev-package")) {
    console.log(
      `\n${id}: dev build ready, not zipped. This DLL sends every client to ${devPath}. Install ` +
        `mod/bin/Release by hand, or pass --allow-dev-package to zip it for one machine.`,
    );
    return 0;
  }

  step("package the mod");
  const packaged = packageMod(uplinkDir, outDir);
  console.log(
    `\n${id}: both halves built.\n` +
      (bundlePath
        ? `  client  ${bundlePath} (and gonogo-uplink.json beside it)\n`
        : "") +
      `  mod     ${packaged.zip}\n` +
      packaged.files.map((file) => `          ${file}`).join("\n") +
      (baked.hash ? `\n  hash    ${baked.hash}, baked into the plugin` : "") +
      (devPath ? `\n  DEV BUILD, DevPath ${devPath}` : ""),
  );
  return 0;
}
