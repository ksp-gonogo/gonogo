import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type * as TS from "typescript";
import { workspaceSourcePaths } from "./workspace";

export type TypeScript = typeof TS;

/** The check cannot run at all, as opposed to having found something. */
export class CheckUnableError extends Error {}

/**
 * The author's own TypeScript, found from the client directory, falling back to
 * the one beside this package. It is an optional peer: the scaffold writes it,
 * and no other command needs it.
 */
export async function loadTypeScript(fromDir: string): Promise<TypeScript> {
  let dir = resolve(fromDir);
  for (;;) {
    const entry = join(
      dir,
      "node_modules",
      "typescript",
      "lib",
      "typescript.js",
    );
    if (existsSync(entry)) {
      const loaded: { default?: TypeScript } & TypeScript = await import(
        pathToFileURL(entry).href
      );
      return loaded.default ?? loaded;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    const loaded: { default?: TypeScript } & TypeScript = await import(
      "typescript"
    );
    return loaded.default ?? loaded;
  } catch {
    throw new CheckUnableError(
      "typescript is not installed where the client can reach it. check reads the client with the " +
        "TypeScript compiler:\n  npm i -D typescript",
    );
  }
}

/**
 * The client's program, built from its own tsconfig.json. With `workspace`, the
 * private packages of the gonogo workspace the client sits in resolve to their
 * source, so their hooks can be read; outside that workspace it changes nothing.
 */
export function createClientProgram(
  ts: TypeScript,
  clientDir: string,
  options: { workspace?: boolean } = {},
): TS.Program {
  const configPath = join(clientDir, "tsconfig.json");
  if (!existsSync(configPath)) {
    throw new CheckUnableError(
      `${clientDir} has no tsconfig.json, so there is no program to read. Name the client with --client <dir>.`,
    );
  }
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    throw new CheckUnableError(
      `${configPath} cannot be read: ${ts.flattenDiagnosticMessageText(read.error.messageText, "\n")}`,
    );
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, clientDir);
  if (parsed.fileNames.length === 0) {
    throw new CheckUnableError(
      `${configPath} includes no source files, so there is nothing to read.`,
    );
  }
  const workspacePaths = options.workspace
    ? workspaceSourcePaths(clientDir)
    : {};
  return ts.createProgram({
    rootNames: parsed.fileNames,
    options: {
      ...parsed.options,
      noEmit: true,
      paths: { ...workspacePaths, ...parsed.options.paths },
    },
  });
}

/** An in-memory program over `files` (absolute path to text), for tests. */
export function createMemoryProgram(
  ts: TypeScript,
  files: Readonly<Record<string, string>>,
): TS.Program {
  const options: TS.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const original = { ...host };
  host.fileExists = (name) => name in files || original.fileExists(name);
  host.directoryExists = (name) =>
    Object.keys(files).some((file) => file.startsWith(`${name}/`)) ||
    original.directoryExists?.(name) === true;
  host.readFile = (name) => files[name] ?? original.readFile(name);
  host.getSourceFile = (name, languageVersion) => {
    const text = files[name];
    return text === undefined
      ? original.getSourceFile(name, languageVersion)
      : ts.createSourceFile(name, text, languageVersion, true);
  };
  return ts.createProgram({
    rootNames: Object.keys(files),
    options,
    host,
  });
}
