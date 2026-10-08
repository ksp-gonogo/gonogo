import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { UPLINK_BUNDLE_EXTERNALS } from "@ksp-gonogo/sitrep-sdk/uplink-externals";
import { CheckUnableError, type TypeScript } from "../../program";
import type { CheckContext, FixableFinding, Rule } from "../../types";

const SCOPE = "@ksp-gonogo/";

/** The only packages of this ecosystem an Uplink can install. */
const PUBLISHED = ["sitrep-sdk", "ui-kit"];

/** The sdk subpaths an author may import; `/spine` and `/registry` resolve at runtime for first-party code only. */
const SDK_AUTHOR_SUBPATHS = ["frames", "media", "testing"];

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SKIPPED_DIRS = new Set(["node_modules", "dist"]);

function loadTypeScriptSync(clientDir: string): TypeScript {
  for (const from of [
    join(clientDir, "package.json"),
    fileURLToPath(import.meta.url),
  ]) {
    try {
      const loaded: { default?: TypeScript } & TypeScript =
        createRequire(from)("typescript");
      return loaded.default ?? loaded;
    } catch {
      // Not installed there: try the next place.
    }
  }
  throw new CheckUnableError(
    "typescript is not installed where the client can reach it. check reads the client with the TypeScript compiler:\n  npm i -D typescript",
  );
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) found.push(...sourceFiles(path));
      continue;
    }
    if (SOURCE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      found.push(path);
    }
  }
  return found.sort();
}

/** Why a specifier of this ecosystem cannot be used in a client's source, or nothing. */
export function importFault(
  specifier: string,
  isTest: boolean,
): { rule: string; message: string; fix: string } | undefined {
  if (!specifier.startsWith(SCOPE)) return undefined;
  const [pkg, ...sub] = specifier.slice(SCOPE.length).split("/");
  const subpath = sub.join("/");
  if (!PUBLISHED.includes(pkg)) {
    return {
      rule: "imports/private-package",
      message: `${specifier} is a private package of the gonogo repository, so nobody outside it can install or build against it.`,
      fix: "Import it from @ksp-gonogo/sitrep-sdk or @ksp-gonogo/ui-kit. If what you need is missing there, ask for it to be moved into one.",
    };
  }
  if (
    pkg === "sitrep-sdk" &&
    subpath &&
    !SDK_AUTHOR_SUBPATHS.includes(subpath)
  ) {
    return {
      rule: "imports/sdk-subpath",
      message: `${specifier} is not an author surface of the sdk. The permitted subpaths are ${SDK_AUTHOR_SUBPATHS.map((s) => `/${s}`).join(", ")}.`,
      fix: "Import from @ksp-gonogo/sitrep-sdk, or one of the permitted subpaths.",
    };
  }
  if (!isTest && !UPLINK_BUNDLE_EXTERNALS.includes(specifier)) {
    return {
      rule: "imports/not-in-import-map",
      message: `${specifier} is not one of the specifiers the app resolves for a loaded client, so the bundle would carry or lose it and fail at import time. Only a test file may import it.`,
      fix: "Move the import into a test file, or import the same thing from a specifier the app resolves.",
    };
  }
  return undefined;
}

export const importsRule: Rule = {
  id: "imports/source",
  group: "imports",
  check({ clientDir }: CheckContext): FixableFinding[] {
    const ts = loadTypeScriptSync(clientDir);
    const out: FixableFinding[] = [];
    for (const file of sourceFiles(join(clientDir, "src"))) {
      const source = readFileSync(file, "utf8");
      if (!source.includes(SCOPE)) continue;
      const isTest = TEST_FILE.test(file);
      for (const imported of ts.preProcessFile(source, true, true)
        .importedFiles) {
        const fault = importFault(imported.fileName, isTest);
        if (!fault) continue;
        out.push({
          rule: fault.rule,
          severity: "error",
          file,
          line: source.slice(0, imported.pos).split("\n").length,
          message: fault.message,
          fixable: false,
          fix: fault.fix,
        });
      }
    }
    return out;
  },
};

export const importsRules: readonly Rule[] = [importsRule];
