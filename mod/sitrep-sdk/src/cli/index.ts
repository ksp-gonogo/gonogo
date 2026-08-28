/**
 * The `gonogo-uplink` command an Uplink author actually runs.
 *
 * ## Why it moved here
 *
 * Release-time tooling that only exists inside the gonogo repo is tooling a
 * stranger cannot run, and a template whose getting-started calls it is a
 * template that is broken the moment it is generated. `bundle` existed only as an
 * 80-line Vite plugin inside the app; `bake-hash` existed only as
 * `mod/scripts/bake-client-hash.mjs`, which ships in neither published package.
 * Both are here now because here is what an author installs.
 *
 * ## One command, and the browser half stays lazy
 *
 * `render` and `docs` drive Playwright through `@ksp-gonogo/ui-kit` and are
 * forwarded to it, imported only when one of those verbs is actually used. An
 * author running `bundle` in CI does not pay for a browser driver they are not
 * using, and the sdk keeps no dependency on ui-kit.
 *
 * Two commands would have been the alternative and it is worse: a second tool is
 * a second thing to discover, version and document, and an author has no way to
 * know which of the two owns the verb they want.
 *
 * ## esbuild and ui-kit are NOT declared as optional peers
 *
 * They are the author's, resolved at the moment a verb needs one, and each
 * missing case throws with the exact install command. Declaring them as peers
 * instead conveys the same information less well AND breaks the workspace: pnpm
 * resolves a per-peer INSTANCE of a workspace package and COPIES it rather than
 * linking, so this package's `src` arrives without the files a consumer resolves
 * and 4 core suites fail with "Stripping types is currently unsupported for files
 * under node_modules". ui-kit's own tsup config documents the same trap for the
 * same reason.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
// `.js`, explicitly. This package emits unbundled ESM and Node's resolver needs
// the extension; `moduleResolution: "bundler"` accepts it too, so it is correct
// in both modes. This CLI is the first thing here RUN from `dist` rather than
// typechecked, which is why it is the first to care.
import { UPLINK_BUNDLE_EXTERNALS } from "../uplink-externals.js";

const USAGE = `gonogo-uplink <command>

  bundle     build the client bundle the app loads, and its gonogo-uplink.json
  bake-hash  write a client bundle's sha256 into C#, for the mod to vouch for
  render     render this Uplink's widgets to images (needs @ksp-gonogo/ui-kit)
  docs       generate this Uplink's README assets (needs @ksp-gonogo/ui-kit)

Run a command with --help for its options.`;

/** Read a JSON file, or fail saying which one and why. */
function readJson(path: string, what: string): Record<string, unknown> {
  if (!existsSync(path)) {
    throw new Error(`${what} not found at ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `${what} at ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const flag = (argv: readonly string[], name: string): string | undefined =>
  argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;

/**
 * The version of a package as INSTALLED, read from its own manifest.
 *
 * Not from the dependency range in the client's package.json, which is a
 * specifier and not a version: `^0.2.0` is not `0.2.0`, and a `file:` spec is not
 * a version at all. Deriving it produced `"0.2.0.tgz"` from a tarball path, which
 * would have shipped in a GATE field the loader compares, failing compatibility
 * for a reason no one could read.
 *
 * Empty when the package is not installed rather than throwing: an Uplink that
 * does not use ui-kit still has a bundle to describe.
 */
function installedVersion(fromDir: string, pkg: string): string {
  let dir = fromDir;
  for (let up = 0; up < 6; up++) {
    const manifest = join(dir, "node_modules", pkg, "package.json");
    if (existsSync(manifest)) {
      return String(
        (JSON.parse(readFileSync(manifest, "utf8")) as { version?: string })
          .version ?? "",
      );
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "";
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
async function bundle(argv: readonly string[]): Promise<number> {
  const clientDir = resolve(flag(argv, "--client") ?? process.cwd());
  const outDir = resolve(flag(argv, "--out") ?? join(clientDir, "dist"));
  const manifest = readJson(
    join(clientDir, "package.json"),
    "the client's package.json",
  );

  /*
   * `uplink.json` is the Uplink's own declaration and sits beside BOTH halves, so
   * it is one level up from a flat layout's client and two from a monorepo's.
   * Searched rather than required at a fixed path, because the template is flat
   * and the operator's monorepo is not.
   */
  let uplinkDir = clientDir;
  for (
    let up = 0;
    up < 3 && !existsSync(join(uplinkDir, "uplink.json"));
    up++
  ) {
    uplinkDir = dirname(uplinkDir);
  }
  const declaredPath = join(uplinkDir, "uplink.json");
  if (!existsSync(declaredPath)) {
    throw new Error(
      `no uplink.json found in ${clientDir} or its parents. It declares the id, the author and ` +
        "the client URL, and the bundle cannot be described without it.",
    );
  }
  const declared = readJson(declaredPath, "uplink.json");
  const id = String(declared.id ?? "");
  if (!id) throw new Error(`${declaredPath} declares no id`);

  const entry = resolve(clientDir, flag(argv, "--entry") ?? "src/index.ts");
  if (!existsSync(entry)) {
    throw new Error(`entry ${entry} does not exist`);
  }

  /*
   * esbuild is the AUTHOR's dependency, resolved from their client rather than
   * bundled here: the sdk declares no dependencies and an author who pins a
   * particular esbuild gets the one they pinned.
   */
  let build: typeof import("esbuild").build;
  try {
    ({ build } = (await import("esbuild")) as typeof import("esbuild"));
  } catch {
    throw new Error(
      "esbuild is not installed. It is the bundler this uses and it is your dependency, not the " +
        "sdk's, so an author who pins a version gets the one they pinned:\n  npm i -D esbuild",
    );
  }

  const bundleDir = join(outDir, id);
  mkdirSync(bundleDir, { recursive: true });
  const outFile = join(bundleDir, `${id}.client.js`);

  await build({
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    external: [...UPLINK_BUNDLE_EXTERNALS],
    plugins: [
      {
        // Every CSS import folded into the one JS bundle as a self-injecting
        // <style>. The loader fetches only the JS, so a sibling .css esbuild
        // emitted would never be applied and the widget would render unstyled
        // with nothing failing. It also keeps the whole client under ONE hash.
        name: "gonogo-css-inject",
        setup(pluginBuild) {
          pluginBuild.onLoad({ filter: /\.css$/ }, (args) => ({
            loader: "js" as const,
            contents:
              'if (typeof document !== "undefined") {' +
              "const s = document.createElement('style');" +
              `s.textContent = ${JSON.stringify(readFileSync(args.path, "utf8"))};` +
              "document.head.appendChild(s);}",
          }));
        },
      },
    ],
    logLevel: "warning",
  });

  const bytes = readFileSync(outFile);
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
        ...bytes.toString("utf8").matchAll(/from\s*"(@ksp-gonogo\/[^"]+)"/g),
      ].map((match) => match[1]),
    ),
  ].filter((spec) => !UPLINK_BUNDLE_EXTERNALS.includes(spec));
  if (kept.length > 0) {
    throw new Error(
      `the bundle imports ${kept.join(", ")}, which the app's import map does not resolve. It ` +
        "would load in a bundler and throw at import(bundleUrl) in the app.",
    );
  }

  const sdkVersion = (await import("../version.generated.js")).SDK_VERSION;
  writeFileSync(
    join(bundleDir, "gonogo-uplink.json"),
    `${JSON.stringify(
      {
        id,
        name: declared.name ?? id,
        author: declared.author ?? "",
        repo: declared.repo ?? "",
        version: manifest.version ?? "0.0.0",
        minAppVersion: declared.minAppVersion ?? "0.0.0",
        apiVersion: (await import("../compat-versions.js"))
          .EXTENSION_API_VERSION,
        uiKitVersion: installedVersion(clientDir, "@ksp-gonogo/ui-kit"),
        contractMajor: (await import("../compat-versions.js")).CONTRACT_MAJOR,
        contractMinor: (await import("../compat-versions.js")).CONTRACT_MINOR,
        bundleUrl: `${id}/${id}.client.js`,
        integrity,
        sdkVersion,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(`${outFile}.sha256`, `${integrity}\n`);

  console.log(`${id}: ${(bytes.length / 1024).toFixed(1)} KB -> ${outFile}`);
  console.log(`  integrity  ${integrity}`);
  return 0;
}

/**
 * Write a bundle's sha256 into a generated C# const, so the running mod can
 * vouch for the client it was released with.
 *
 * The loader compares three witnesses: the index's hash, the bytes it fetched,
 * and this. Leave it empty and the check silently becomes two-way, which is what
 * every bundled Uplink has been doing.
 *
 * ORDER MATTERS and is not the author's to remember: the bundle must exist and be
 * hashed BEFORE the DLL is compiled, or the DLL vouches for bytes that are not
 * the ones shipped. A release script owns that sequence.
 */
async function bakeHash(argv: readonly string[]): Promise<number> {
  const bundlePath = flag(argv, "--bundle");
  const out = flag(argv, "--out");
  const namespace = flag(argv, "--namespace");
  if (!bundlePath || !out || !namespace) {
    throw new Error(
      "bake-hash needs --bundle <file> --out <ExpectedClientHash.g.cs> --namespace <C# namespace>",
    );
  }
  if (!existsSync(bundlePath)) {
    throw new Error(
      `${bundlePath} does not exist. Hashing a bundle that was never built would bake a value ` +
        "the loader can never match, which fails as tampering rather than as a bad build.",
    );
  }
  const hash = `sha256-${createHash("sha256")
    .update(readFileSync(bundlePath))
    .digest("hex")}`;
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(
    resolve(out),
    `// <auto-generated> Written by \`gonogo-uplink bake-hash\`. DO NOT EDIT.
//
// The sha256 of the client bundle this DLL was built alongside. Empty leaves
// UplinkManifest.ExpectedClientHash null and the loader's three-way check running
// two-way, recorded as pending rather than passed.
namespace ${namespace}
{
    internal static class ExpectedClientHash
    {
        public const string Value = "${hash}";
    }
}
`,
  );
  console.log(`baked ${hash} -> ${out}`);
  return 0;
}

/**
 * Forward a browser verb to ui-kit's CLI, imported HERE rather than at module
 * scope so `bundle` and `bake-hash` never load Playwright or a DOM stack.
 */
async function forwardToUiKit(argv: readonly string[]): Promise<number> {
  try {
    /*
     * A variable specifier, deliberately. ui-kit is an OPTIONAL peer: it depends
     * on this package, so a static import would be a cycle, and a literal
     * specifier would make tsc resolve a module the sdk does not and must not
     * depend on. Held in a variable, the import is a runtime lookup and the
     * missing-module case below is the whole error handling it needs.
     */
    const uiKitRender = "@ksp-gonogo/ui-kit/render";
    const { run } = (await import(uiKitRender)) as {
      run: (argv: readonly string[]) => Promise<number>;
    };
    return await run(argv);
  } catch (err) {
    if (
      err instanceof Error &&
      /Cannot find (module|package)|ERR_MODULE_NOT_FOUND/.test(err.message)
    ) {
      throw new Error(
        `\`${argv[0]}\` renders in a real browser and lives in @ksp-gonogo/ui-kit, which is not ` +
          "installed:\n  npm i -D @ksp-gonogo/ui-kit playwright\n" +
          "`bundle` and `bake-hash` need neither, which is why this is not a dependency of the sdk.",
      );
    }
    throw err;
  }
}

export async function run(argv: readonly string[]): Promise<number> {
  const verb = argv[0];
  if (!verb || verb === "--help" || verb === "-h") {
    console.log(USAGE);
    return 0;
  }
  try {
    if (verb === "bundle") return await bundle(argv.slice(1));
    if (verb === "bake-hash") return await bakeHash(argv.slice(1));
    if (verb === "render" || verb === "docs") return await forwardToUiKit(argv);
    console.error(`unknown command "${verb}"\n\n${USAGE}`);
    return 1;
  } catch (err) {
    console.error(`\n${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
