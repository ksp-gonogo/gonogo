import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { UPLINK_BUNDLE_EXTERNALS } from "@ksp-gonogo/sitrep-sdk/uplink-externals";
import { bakeUplink, findUplinkDir } from "../../../cli/bake";
import { CheckUnableError } from "../../program";
import type { CheckContext, FixableFinding, Rule } from "../../types";

const GROUP = "bake";

/** The three files `bake` writes into the plugin, by the name each has under `mod/`. */
const BAKED_FILES = [
  "Provenance.g.cs",
  "ClientSource.g.cs",
  "ExpectedClientHash.g.cs",
];

/**
 * Builds the client the way `bundle` builds it and writes the bytes to `outFile`.
 * It runs in a child process because esbuild's plugin API is asynchronous and a
 * rule answers synchronously; the options are the ones `bundle` passes, and
 * `bake.test.ts` holds the two to the same bytes. esbuild writes each module's
 * path, relative to the working directory, into the output, so the hash depends
 * on where the build runs: from the client directory, as the package scripts do.
 */
const BUILD_SCRIPT = `
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [esbuildEntry, entry, outFile, externalJson] = process.argv.slice(1);
const loaded = await import(pathToFileURL(esbuildEntry).href);
const esbuild = loaded.default ?? loaded;
const cssInject = {
  name: "gonogo-css-inject",
  setup(build) {
    build.onLoad({ filter: /\\.css$/ }, (args) => ({
      loader: "js",
      contents:
        'if (typeof document !== "undefined") {' +
        "const s = document.createElement('style');" +
        "s.textContent = " + JSON.stringify(readFileSync(args.path, "utf8")) + ";" +
        "document.head.appendChild(s);}",
    }));
  },
};
const result = await esbuild.build({
  entryPoints: [entry],
  outfile: outFile,
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  external: JSON.parse(externalJson),
  logLevel: "silent",
  plugins: [cssInject],
});
writeFileSync(outFile, result.outputFiles[0].contents);
`;

function esbuildEntry(clientDir: string): string {
  const here = fileURLToPath(import.meta.url);
  for (const from of [join(clientDir, "package.json"), here]) {
    try {
      return createRequire(from).resolve("esbuild");
    } catch {
      // Not installed there: try the next place.
    }
  }
  throw new CheckUnableError(
    "esbuild is not installed. The bake group builds the client with it in memory, and it is a peer of this package:\n  npm i -D esbuild",
  );
}

export type BuildClient = (
  clientDir: string,
  outFile: string,
) => { ok: true } | { ok: false; message: string };

/** The client's bundle written to `outFile`, built by esbuild in a child process. */
export const buildClient: BuildClient = (clientDir, outFile) => {
  const entry = join(clientDir, "src", "index.ts");
  if (!existsSync(entry)) {
    return {
      ok: false,
      message: `${entry} does not exist, so there is no client to bundle. bundle's default entry is src/index.ts.`,
    };
  }
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      BUILD_SCRIPT,
      esbuildEntry(clientDir),
      entry,
      outFile,
      JSON.stringify([...UPLINK_BUNDLE_EXTERNALS]),
    ],
    { encoding: "utf8", cwd: clientDir },
  );
  if (result.status === 0) return { ok: true };
  return {
    ok: false,
    message: (result.stderr || result.stdout || "esbuild failed")
      .trim()
      .split("\n")[0],
  };
};

function writeAtomic(path: string, content: string) {
  const temp = `${path}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, path);
}

/** What `bake` would write for the client as it builds now: the content of each file by name. */
function expectedBake(
  uplinkDir: string,
  clientDir: string,
  build: BuildClient,
): { files: Map<string, string> } | { failed: string } {
  const scratch = mkdtempSync(join(tmpdir(), "uplink-bake-check-"));
  try {
    mkdirSync(join(scratch, "client"), { recursive: true });
    mkdirSync(join(scratch, "mod"), { recursive: true });
    cpSync(join(uplinkDir, "uplink.json"), join(scratch, "uplink.json"));
    if (existsSync(join(clientDir, "package.json"))) {
      cpSync(
        join(clientDir, "package.json"),
        join(scratch, "client", "package.json"),
      );
    }
    let declared: unknown;
    try {
      declared = JSON.parse(
        readFileSync(join(uplinkDir, "uplink.json"), "utf8"),
      );
    } catch {
      declared = {};
    }
    const client = Reflect.get(Object(declared), "client");
    const hasClient =
      typeof Reflect.get(Object(client), "url") === "string" &&
      Reflect.get(Object(client), "url") !== "";
    let bundle: string | undefined;
    if (hasClient) {
      bundle = join(scratch, "bundle.js");
      const built = build(clientDir, bundle);
      if (!built.ok) return { failed: built.message };
    }
    try {
      bakeUplink({ uplinkDir: scratch, bundle, devPath: "" });
    } catch (err) {
      throw new CheckUnableError(
        err instanceof Error ? err.message : String(err),
      );
    }
    const files = new Map<string, string>();
    for (const name of BAKED_FILES) {
      const file = join(scratch, "mod", name);
      if (existsSync(file)) files.set(name, readFileSync(file, "utf8"));
    }
    return { files };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const hashOf = (source: string): string | undefined =>
  /Value = "([^"]*)"/.exec(source)?.[1];

export function bakeRule(build: BuildClient = buildClient): Rule {
  return {
    id: "bake/stale",
    group: GROUP,
    check({ clientDir }: CheckContext): FixableFinding[] {
      const uplinkDir = findUplinkDir(clientDir);
      if (!uplinkDir || !existsSync(join(uplinkDir, "mod"))) return [];
      const expected = expectedBake(uplinkDir, clientDir, build);
      if ("failed" in expected) {
        return [
          {
            rule: "bake/bundle-failed",
            severity: "error",
            file: join(clientDir, "src", "index.ts"),
            line: 1,
            message: `The client does not bundle, so the hash the plugin should vouch for cannot be worked out: ${expected.failed}`,
            fixable: false,
            fix: "Run `uplink-tools bundle` and fix what it reports.",
          },
        ];
      }
      const out: FixableFinding[] = [];
      for (const [name, content] of expected.files) {
        const path = join(uplinkDir, "mod", name);
        if (!existsSync(path)) {
          out.push({
            rule: "bake/missing",
            severity: "warning",
            file: path,
            line: 1,
            message: `${name} has not been written here, and the plugin does not compile without it.`,
            fixable: true,
            fix: "Run `uplink-tools bundle` then `uplink-tools bake --bundle <file>`, or `release`.",
            apply: () => writeAtomic(path, content),
          });
          continue;
        }
        const committed = readFileSync(path, "utf8");
        if (committed === content) continue;
        const detail =
          name === "ExpectedClientHash.g.cs"
            ? ` The plugin vouches for ${hashOf(committed) || "no hash"} and the client now builds to ${hashOf(content)}, so the app would refuse the client as tampered with.`
            : "";
        out.push({
          rule: "bake/stale",
          severity: "error",
          file: path,
          line: 1,
          message: `${name} is not what bake writes for this client as it builds now.${detail}`,
          fixable: true,
          fix: "Run `uplink-tools bundle` then `uplink-tools bake --bundle <file>`, and commit what it writes.",
          apply: () => writeAtomic(path, content),
        });
      }
      return out;
    },
  };
}

export const bakeRules: readonly Rule[] = [bakeRule()];
