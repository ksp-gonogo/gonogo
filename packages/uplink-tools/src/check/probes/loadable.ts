import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CheckUnableError } from "../program";
import type { Finding } from "../types";

export const LOADABLE_GROUP = "loadable";

const SCOPE = "@ksp-gonogo/";

/**
 * Fewer entry points than this means the installed manifests were not read, and
 * attempting nothing would report the same success as attempting everything.
 */
const MIN_ENTRY_POINTS = 6;

/**
 * Entry points a bare `node` cannot import today, each with the cause.
 *
 * All of them reach one chunk of `@ksp-gonogo/ui-kit`, which evaluates
 * `styled.button` at module scope after `import styled from "styled-components"`.
 * styled-components publishes no `exports` map, so Node takes its CommonJS
 * `main` and the default arrives as the namespace object. Nothing about it is
 * the client's to fix, and a bundler resolves it, so these are not attempted as
 * loads. An entry that starts loading is reported, so the list shrinks instead
 * of outliving its cause.
 */
export const EXEMPT: Readonly<Record<string, string>> = {
  "@ksp-gonogo/ui-kit": "evaluates styled.button at module scope",
  "@ksp-gonogo/ui-kit/testing": "reaches the same chunk as the root barrel",
  "@ksp-gonogo/uplink-tools/render-probe": "reaches the ui-kit barrel",
  "@ksp-gonogo/uplink-tools/page-check": "reaches the ui-kit barrel",
  "@ksp-gonogo/uplink-tools/widgets": "reaches the ui-kit barrel",
};

/**
 * Only a package gonogo publishes is held to loading in Node. One from another
 * repository, whatever its scope, is not gonogo's to fix and the client bundle
 * inlines it, so a bare `node` failing to import it says nothing about the client.
 */
const GONOGO_REPOSITORY = /github\.com\/ksp-gonogo\/gonogo(\.git)?(\/|$)/;

function isGonogoPublished(manifest: Record<string, unknown>): boolean {
  const repository = manifest.repository;
  const url =
    typeof repository === "string" ? repository : asRecord(repository).url;
  return typeof url === "string" && GONOGO_REPOSITORY.test(url);
}

/** A subpath nothing resolves through the module graph, so importing it proves nothing. */
const NOT_A_MODULE = (sub: string) =>
  sub === "biome" || sub.endsWith(".json") || sub.endsWith(".css");

export interface LoadResult {
  ok: boolean;
  /** The first error line, when it did not load. */
  cause: string;
}

/** Imports `specifier` in a bare node process started in `cwd`. */
export function loadInBareNode(specifier: string, cwd: string): LoadResult {
  const run = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(specifier)});`,
    ],
    { cwd, encoding: "utf8" },
  );
  if (run.status === 0) return { ok: true, cause: "" };
  const cause =
    (run.stderr || "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^(\w*Error)\b/.test(line)) ?? "no diagnostic";
  return { ok: false, cause };
}

export interface LoadableOptions {
  /** Replaced in tests. */
  load?: (specifier: string, cwd: string) => LoadResult;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function readJson(path: string): Record<string, unknown> {
  return asRecord(JSON.parse(readFileSync(path, "utf8")));
}

/** The `@ksp-gonogo` packages the client depends on, read off its own manifest. */
function dependedPackages(clientDir: string): string[] {
  const manifest = readJson(join(clientDir, "package.json"));
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(asRecord(manifest[field]))) {
      if (name.startsWith(SCOPE)) names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * The module entry points those packages export, read off the INSTALLED
 * manifests. A package depended on and not installed stops the run: skipping
 * it would leave the total reading as complete.
 */
function entryPoints(clientDir: string): string[] {
  const modules = join(clientDir, "node_modules");
  const specs: string[] = [];
  const missing: string[] = [];
  for (const pkg of dependedPackages(clientDir)) {
    const manifestFile = join(modules, pkg, "package.json");
    if (!existsSync(manifestFile)) {
      missing.push(pkg);
      continue;
    }
    const manifest = readJson(manifestFile);
    if (!isGonogoPublished(manifest)) continue;
    for (const key of Object.keys(asRecord(manifest.exports))) {
      if (key === ".") {
        specs.push(pkg);
        continue;
      }
      if (key.startsWith("./") && !NOT_A_MODULE(key.slice(2))) {
        specs.push(`${pkg}/${key.slice(2)}`);
      }
    }
  }
  if (missing.length > 0) {
    throw new CheckUnableError(
      `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} depended on and not installed, so nothing about ${missing.length === 1 ? "it" : "them"} would be attempted. Run npm install in ${clientDir}.`,
    );
  }
  if (specs.length < MIN_ENTRY_POINTS) {
    throw new CheckUnableError(
      `found only ${specs.length} published entry point(s) to try, expected at least ${MIN_ENTRY_POINTS}. Either the installed manifests moved their exports maps or node_modules is not what it looks like, and importing nothing would report the same success as importing everything.`,
    );
  }
  return specs;
}

/**
 * Proves the loader can still tell a module that loads from one that does not,
 * before any result is trusted. A loader that reports success for a module
 * that throws would pass every dependency, and zero findings reads as success.
 */
function proveLoaderSees(
  load: (specifier: string, cwd: string) => LoadResult,
): void {
  const dir = mkdtempSync(join(tmpdir(), "uplink-loadable-"));
  try {
    const fine = join(dir, "fine.mjs");
    const broken = join(dir, "broken.mjs");
    writeFileSync(fine, "export const ok = true;\n");
    writeFileSync(broken, 'throw new TypeError("planted");\n');
    const sees = load(pathToFileURL(fine).href, dir);
    const refuses = load(pathToFileURL(broken).href, dir);
    if (!sees.ok || refuses.ok) {
      throw new CheckUnableError(
        "BLIND. The loader reported a module that throws as loading, or one that loads as failing, so no result for this client is trustworthy.",
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Can every published `@ksp-gonogo` entry point the client depends on be
 * imported by a bare `node`? A green test run does not answer it: the test
 * runner inlines these packages, and its resolver performs the extension
 * search Node refuses to, so a package no Node process can import passes.
 */
export function checkLoadable(
  clientDir: string,
  options: LoadableOptions = {},
): Finding[] {
  const load = options.load ?? loadInBareNode;
  const specs = entryPoints(clientDir);
  proveLoaderSees(load);
  const manifest = join(clientDir, "package.json");
  const findings: Finding[] = [];
  for (const spec of specs) {
    const result = load(spec, clientDir);
    const exempt = spec in EXEMPT;
    if (!result.ok && !exempt) {
      findings.push({
        rule: "loadable/entry-point",
        severity: "error",
        file: manifest,
        line: 1,
        message: `${spec} cannot be imported by a bare node: ${result.cause}. Anything that imports it outside a bundler fails the same way.`,
        fixable: false,
        fix: "Install the release of the package the Gonogo mod and app are built against, and report it to the package's repository if it still fails.",
      });
    }
    if (result.ok && exempt) {
      findings.push({
        rule: "loadable/stale-exemption",
        severity: "warning",
        file: manifest,
        line: 1,
        message: `${spec} loads now, but this uplink-tools still treats it as one that cannot (${EXEMPT[spec]}), so it is not being held to loading.`,
        fixable: false,
        fix: "Update @ksp-gonogo/uplink-tools.",
      });
    }
  }
  return findings;
}
