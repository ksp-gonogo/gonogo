/**
 * The `uplink-tools` command an Uplink author runs, and the one their release
 * workflow calls: `npx @ksp-gonogo/uplink-tools <command>`.
 *
 * One bin, named after the package. npx runs the bin whose name matches the
 * package's unscoped name, so `npx @ksp-gonogo/uplink-tools new` works with
 * nothing installed, and an installed copy answers to the same name in a
 * `package.json` script.
 *
 * `render` and `docs` drive Playwright and are imported only when one of them
 * runs, so no other command loads a browser driver.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { UPLINK_BUNDLE_EXTERNALS } from "@ksp-gonogo/sitrep-sdk/uplink-externals";
import {
  buildUplinkManifest,
  readUplinkDeclaration,
  serialiseUplinkManifest,
  UPLINK_MANIFEST_FILE,
} from "@ksp-gonogo/sitrep-sdk/uplink-manifest";
import { BAKE_USAGE, bake } from "./bake";
import { CODEGEN_USAGE, codegen } from "./codegen";
import { parseFlags, wantsHelp } from "./flags";
import { NEW_USAGE, newUplink } from "./new";
import { PACKAGE_USAGE, packageCommand } from "./package";
import { RELEASE_USAGE, release } from "./release";

/** Beside the bundle: what a watch last did, for the app's dev server to read. */
const WATCH_STATUS_FILE = "watch-status.json";

const USAGE = `uplink-tools <command>

  new      scaffold a fresh Uplink: the hand-written seed, then its generators
  codegen  generate the client's types from the C# contract slice
  bundle   build the client bundle the app loads, and its gonogo-uplink.json
  bake     write what the plugin tells the app about its client into C#: where
           the bundle lives, who wrote it and the hash the mod vouches for
  package  lay the built plugin out as GameData and zip it
  release  bundle, bake, compile the plugin and package, in the order that
           gives a plugin the app will load a client for
  render   render this Uplink's widgets to images
  docs     this Uplink's README, its assets and the SAME gonogo-uplink.json
           that bundle writes

Run a command with --help for its options. Without an install:
  npx @ksp-gonogo/uplink-tools <command>`;

/**
 * The ui-kit version the client is built against, as the kit itself states it
 * for compatibility.
 *
 * The app compares this with its own `UI_KIT_VERSION`, so what is recorded has
 * to be that same constant from the installed kit, which the kit writes to
 * `dist/compat.json`. It is not the installed package's version: a release
 * stamps the packed manifest with the release version and leaves the constant
 * where it was, so the two differ in every published kit.
 *
 * A kit that predates `compat.json` is read by its package version, which is
 * what was recorded for it before. Empty when the kit is not installed rather
 * than throwing: an Uplink that does not use ui-kit still has a bundle to
 * describe.
 */
function uiKitCompatVersion(fromDir: string): string {
  const dir = installedPackageDir(fromDir, "@ksp-gonogo/ui-kit", 6);
  if (!dir) return "";
  const compat = join(dir, "dist", "compat.json");
  const stated: unknown = existsSync(compat)
    ? Reflect.get(readManifest(compat), "uiKitVersion")
    : Reflect.get(readManifest(join(dir, "package.json")), "version");
  return typeof stated === "string" ? stated : "";
}

/** The directory `pkg` is installed in, walking up from `fromDir` at most `levels` times. */
function installedPackageDir(
  fromDir: string,
  pkg: string,
  levels = Number.POSITIVE_INFINITY,
): string | undefined {
  let dir = resolve(fromDir);
  for (let up = 0; up <= levels; up++) {
    const candidate = join(dir, "node_modules", pkg);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

interface CompatVersions {
  EXTENSION_API_VERSION: string;
  CONTRACT_MAJOR: number;
  CONTRACT_MINOR: number;
}

/**
 * The compatibility stamps of the sdk the client compiles against: the author's
 * own install first, then the one installed beside this package.
 *
 * Read from the sdk's emitted `dist/compat-versions.js` by path rather than
 * through its root export. The root pulls the whole sdk into a Node process for
 * three constants, and inside this repository's workspace it resolves to the
 * sdk's TypeScript source, which bare Node cannot load.
 */
async function compatVersions(clientDir: string): Promise<CompatVersions> {
  const sdk = "@ksp-gonogo/sitrep-sdk";
  const here = dirname(fileURLToPath(import.meta.url));
  const dir =
    installedPackageDir(clientDir, sdk) ?? installedPackageDir(here, sdk);
  const file = dir ? join(dir, "dist", "compat-versions.js") : undefined;
  if (!file || !existsSync(file)) {
    throw new Error(
      `${sdk} is not installed where ${clientDir} can reach it, or carries no ` +
        "dist/compat-versions.js. The manifest's compatibility stamps come from the sdk " +
        `the client compiles against:\n  npm i -D ${sdk}`,
    );
  }
  const loaded: unknown = await import(pathToFileURL(file).href);
  const api = Reflect.get(Object(loaded), "EXTENSION_API_VERSION");
  const major = Reflect.get(Object(loaded), "CONTRACT_MAJOR");
  const minor = Reflect.get(Object(loaded), "CONTRACT_MINOR");
  if (
    typeof api !== "string" ||
    typeof major !== "number" ||
    typeof minor !== "number"
  ) {
    throw new Error(
      `${file} does not export EXTENSION_API_VERSION, CONTRACT_MAJOR and CONTRACT_MINOR, so ` +
        "this sdk cannot stamp a manifest the app will accept. Install a matching sdk.",
    );
  }
  return {
    EXTENSION_API_VERSION: api,
    CONTRACT_MAJOR: major,
    CONTRACT_MINOR: minor,
  };
}

/**
 * Build the standalone ESM bundle the app `import()`s, plus the
 * `gonogo-uplink.json` sidecar beside it.
 *
 * The sidecar's NAME and LOCATION are not free: the loader derives its URL from
 * the bundle's own by stripping the last path segment and appending
 * `gonogo-uplink.json`, so it must sit next to the bundle under exactly that
 * name. Publishing several Uplinks into one flat directory therefore gives them
 * all the same sidecar path and the last one wins, which is why each gets its own
 * directory here.
 */
const BUNDLE_USAGE = `uplink-tools bundle [options]

  Build the ESM bundle the app import()s, plus the gonogo-uplink.json sidecar
  beside it with its integrity hash already filled.

  --client <dir>   the Uplink client package (default: cwd)
  --entry <file>   the module to bundle (default: src/index.ts)
  --out <dir>      output root (default: <client>/dist); the bundle lands in
                   <out>/<id>/<id>.client.js so each Uplink owns its sidecar
  --watch          keep running: rebuild on every source change, and report
                   waiting, built or failed in <out>/<id>/watch-status.json.
                   A failed rebuild leaves the last good bundle in place.
                   Stop it with Ctrl-C`;

async function bundle(argv: readonly string[]): Promise<number> {
  if (wantsHelp(argv)) {
    console.log(BUNDLE_USAGE);
    return 0;
  }
  const { values, switches } = parseFlags(argv, {
    verb: "bundle",
    usage: BUNDLE_USAGE,
    values: ["--client", "--entry", "--out"],
    switches: ["--watch"],
  });
  const clientDir = resolve(values.get("--client") ?? process.cwd());
  const outDir = resolve(values.get("--out") ?? join(clientDir, "dist"));

  const declaration = readUplinkDeclaration(clientDir);
  if (!declaration) {
    throw new Error(
      `no uplink.json found in ${clientDir} or its parents. It declares the id, the author and ` +
        "the client URL, and the bundle cannot be described without it.",
    );
  }
  const id = String(declaration.declared.id ?? "");
  if (!id) throw new Error(`${declaration.path} declares no id`);

  const entry = resolve(clientDir, values.get("--entry") ?? "src/index.ts");
  if (!existsSync(entry)) {
    throw new Error(`entry ${entry} does not exist`);
  }

  let build: typeof import("esbuild").build;
  let context: typeof import("esbuild").context;
  try {
    ({ build, context } = (await import(
      "esbuild"
    )) as typeof import("esbuild"));
  } catch {
    throw new Error(
      "esbuild is not installed. It is the bundler this uses, and a peer of this package so " +
        "an author who pins a version gets the one they pinned:\n  npm i -D esbuild",
    );
  }

  const compat = await compatVersions(clientDir);
  const bundleDir = join(outDir, id);
  mkdirSync(bundleDir, { recursive: true });
  const outFile = join(bundleDir, `${id}.client.js`);
  const watching = switches.has("--watch");

  /*
   * Output is held in memory and written only after the emitted bytes pass the
   * import-map check below, so a bundle that would fail in the browser never
   * replaces the last good one. In a watch that is the difference between a
   * broken save and a broken page.
   */
  const options = {
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    write: false,
    format: "esm" as const,
    platform: "browser" as const,
    target: "es2022",
    jsx: "automatic" as const,
    external: [...UPLINK_BUNDLE_EXTERNALS],
    logLevel: "warning" as const,
  };
  /*
   * Every CSS import folded into the one JS bundle as a self-injecting <style>.
   * The loader fetches only the JS, so a sibling .css esbuild emitted would never
   * be applied and the widget would render unstyled with nothing failing. It also
   * keeps the whole client under ONE hash.
   */
  const cssInject = {
    name: "gonogo-css-inject",
    setup(pluginBuild: import("esbuild").PluginBuild) {
      pluginBuild.onLoad({ filter: /\.css$/ }, (args) => ({
        loader: "js" as const,
        contents:
          'if (typeof document !== "undefined") {' +
          "const s = document.createElement('style');" +
          `s.textContent = ${JSON.stringify(readFileSync(args.path, "utf8"))};` +
          "document.head.appendChild(s);}",
      }));
    },
  };

  const emit = async (bytes: Uint8Array): Promise<string> => {
    const integrity = `sha256-${createHash("sha256").update(bytes).digest("hex")}`;

    /*
     * A `@ksp-gonogo` specifier esbuild kept that the import map does not carry
     * resolves nowhere, and it fails in the browser at `import(bundleUrl)` rather
     * than here. Checked on the EMITTED bytes, since that is the only place a
     * surviving specifier is visible: reading the source would miss one that
     * arrived through a dependency.
     */
    const kept = [
      ...new Set(
        [
          ...Buffer.from(bytes)
            .toString("utf8")
            .matchAll(/from\s*"(@ksp-gonogo\/[^"]+)"/g),
        ].map((match) => match[1]),
      ),
    ].filter((spec) => !UPLINK_BUNDLE_EXTERNALS.includes(spec));
    if (kept.length > 0) {
      throw new Error(
        `the bundle imports ${kept.join(", ")}, which the app's import map does not resolve. It ` +
          "would load in a bundler and throw at import(bundleUrl) in the app.",
      );
    }

    writeFileSync(outFile, bytes);
    writeFileSync(
      join(bundleDir, UPLINK_MANIFEST_FILE),
      serialiseUplinkManifest(
        buildUplinkManifest({
          clientDir,
          compat: {
            apiVersion: compat.EXTENSION_API_VERSION,
            uiKitVersion: uiKitCompatVersion(clientDir),
            contractMajor: compat.CONTRACT_MAJOR,
            contractMinor: compat.CONTRACT_MINOR,
          },
          integrity,
        }),
      ),
    );
    writeFileSync(`${outFile}.sha256`, `${integrity}\n`);
    console.log(`${id}: ${(bytes.length / 1024).toFixed(1)} KB -> ${outFile}`);
    console.log(`  integrity  ${integrity}`);
    return integrity;
  };

  if (!watching) {
    const result = await build({ ...options, plugins: [cssInject] });
    await emit(result.outputFiles?.[0]?.contents ?? new Uint8Array());
    return 0;
  }

  const statusFile = join(bundleDir, WATCH_STATUS_FILE);
  let last: { builtAt: string | null; integrity: string | null } = {
    builtAt: null,
    integrity: null,
  };
  const report = (
    state: "waiting" | "built" | "failed",
    error: string | null,
  ) => {
    // Renamed into place so a reader polling the file never sees half of it.
    const temp = `${statusFile}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ state, ...last, error })}\n`);
    renameSync(temp, statusFile);
  };
  report("waiting", null);

  const ctx = await context({
    ...options,
    plugins: [
      cssInject,
      {
        name: "gonogo-watch-report",
        setup(pluginBuild) {
          pluginBuild.onEnd(async (result) => {
            try {
              if (result.errors.length > 0) {
                const first = result.errors[0];
                const where = first.location
                  ? ` (${first.location.file}:${first.location.line})`
                  : "";
                throw new Error(`${first.text}${where}`);
              }
              const integrity = await emit(
                result.outputFiles?.[0].contents ?? new Uint8Array(),
              );
              last = { builtAt: new Date().toISOString(), integrity };
              report("built", null);
            } catch (err) {
              const message = (
                err instanceof Error ? err.message : String(err)
              ).split("\n")[0];
              console.error(`${id}: build failed: ${message}`);
              report("failed", message);
            }
          });
        },
      },
    ],
  });
  await ctx.watch();
  console.log(`  watching ${join(clientDir, "src")} ...`);
  await new Promise<void>((done) => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => done());
    }
  });
  await ctx.dispose();
  return 0;
}

/**
 * Runs the `uplink-tools` command line with `argv` and returns the exit code.
 *
 * @category Rendering scenes
 */
export async function run(argv: readonly string[]): Promise<number> {
  const verb = argv[0];
  if (!verb || verb === "--help" || verb === "-h") {
    console.log(USAGE);
    return 0;
  }
  try {
    if (verb === "new") {
      if (wantsHelp(argv)) {
        console.log(NEW_USAGE);
        return 0;
      }
      return newUplink(argv.slice(1));
    }
    if (verb === "bundle") return await bundle(argv.slice(1));
    const plain: Record<
      string,
      [string, (argv: readonly string[]) => number | Promise<number>]
    > = {
      bake: [BAKE_USAGE, bake],
      codegen: [CODEGEN_USAGE, codegen],
      package: [PACKAGE_USAGE, packageCommand],
      release: [RELEASE_USAGE, (rest) => release(rest, bundle)],
    };
    if (Object.hasOwn(plain, verb)) {
      const [usage, command] = plain[verb];
      if (wantsHelp(argv)) {
        console.log(usage);
        return 0;
      }
      return await command(argv.slice(1));
    }
    if (verb === "render" || verb === "docs") {
      const { renderOrDocs } = await import("../render/cli").catch(
        (err: unknown) => {
          // The render half draws the client's widgets with the client's own React and ui-kit, so it cannot load where they are not installed.
          if (
            typeof err === "object" &&
            err !== null &&
            Reflect.get(err, "code") === "ERR_MODULE_NOT_FOUND"
          ) {
            throw new Error(
              `${verb} draws this Uplink's widgets, so it needs the client's dependencies, and one ` +
                `is not installed: ${String(Reflect.get(err, "message")).split(" imported from ")[0]}. ` +
                "Run it inside the Uplink's client after `npm install`.",
            );
          }
          throw err;
        },
      );
      await renderOrDocs(argv);
      return 0;
    }
    console.error(`unknown command "${verb}"\n\n${USAGE}`);
    return 1;
  } catch (err) {
    console.error(`\n${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

/** A `package.json`'s top-level object, or a failure naming the file. */
function readManifest(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} does not hold a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}
