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

  The client lands in client/dist/<id>/ and the mod zip in dist/.

  --dev-path <url>      bake a dev server URL for the bundle. The loader prefers
                        it over the released URL, so the result is a dev build
                        and is not zipped
  --allow-dev-package   zip a dev build anyway, to hand to one machine
  --out <dir>           where the mod zip goes (default: dist/ in the Uplink)
  --uplink <dir>        the Uplink's directory, the one holding uplink.json
                        (default: found by walking up from the current directory)`;

/** The GitHub owner \`new\` writes when it was told no repository. A URL under it serves nothing. */
export const PLACEHOLDER_OWNER = "you";

const isPlaceholderUrl = (url: string): boolean =>
  url.includes(`/gh/${PLACEHOLDER_OWNER}/`);

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

  if (url && !devPath && isPlaceholderUrl(url)) {
    throw new Error(
      `uplink.json's client.url is still the placeholder (${url}). A released plugin tells ` +
        "every install to fetch its client from there, and nothing is served there. Set " +
        '"repo" and "client.url" to where the bundle will really be published, then release.',
    );
  }

  const step = (label: string) => console.log(`\n== ${label}`);
  const clientDir = join(uplinkDir, "client");
  let bundlePath: string | undefined;
  if (url) {
    step("bundle the client");
    const code = await bundle(["--client", clientDir]);
    if (code !== 0) return code;
    bundlePath = join(clientDir, "dist", id, `${id}.client.js`);
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
