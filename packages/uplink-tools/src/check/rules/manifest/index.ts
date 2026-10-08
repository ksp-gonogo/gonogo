import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findUplinkDir } from "../../../cli/bake";
import { page } from "../../../cli/page";
import {
  declaredVersionFault,
  placeholderUrlFault,
  urlVersionFault,
} from "../../../cli/release";
import { CheckUnableError } from "../../program";
import type { CheckContext, FixableFinding, Rule } from "../../types";

const GROUP = "manifest";
const SDK = "@ksp-gonogo/sitrep-sdk";

export interface CompatVersions {
  apiVersion: string;
  contractMajor: number;
  contractMinor: number;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return undefined;
  }
}

/** The directory `pkg` is installed in, walking up from `fromDir`. */
function installedPackageDir(fromDir: string, pkg: string): string | undefined {
  let dir = resolve(fromDir);
  for (;;) {
    const candidate = join(dir, "node_modules", pkg);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * The compatibility stamps of the sdk the client compiles against, read from the
 * sdk's emitted `dist/compat-versions.js` exactly as `bundle` reads them: the
 * author's own install first, then the one beside this package.
 *
 * The file is an ES module and a rule answers synchronously, so it is imported
 * by a child process that prints the three values.
 */
export function installedCompat(clientDir: string): CompatVersions {
  const dir =
    installedPackageDir(clientDir, SDK) ??
    installedPackageDir(dirname(fileURLToPath(import.meta.url)), SDK);
  const file = dir ? join(dir, "dist", "compat-versions.js") : undefined;
  if (!file || !existsSync(file)) {
    throw new CheckUnableError(
      `${SDK} is not installed where ${clientDir} can reach it, or carries no dist/compat-versions.js. ` +
        `The manifest's compatibility stamps come from the sdk the client compiles against:\n  npm i -D ${SDK}`,
    );
  }
  const read = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const m = await import(${JSON.stringify(pathToFileURL(file).href)});` +
        "console.log(JSON.stringify([m.EXTENSION_API_VERSION, m.CONTRACT_MAJOR, m.CONTRACT_MINOR]));",
    ],
    { encoding: "utf8" },
  );
  const parsed: unknown = read.status === 0 ? JSON.parse(read.stdout) : [];
  const [apiVersion, contractMajor, contractMinor] = Array.isArray(parsed)
    ? parsed
    : [];
  if (
    typeof apiVersion !== "string" ||
    typeof contractMajor !== "number" ||
    typeof contractMinor !== "number"
  ) {
    throw new CheckUnableError(
      `${file} does not export EXTENSION_API_VERSION, CONTRACT_MAJOR and CONTRACT_MINOR, so this sdk cannot stamp a manifest the app will accept. Install a matching sdk.`,
    );
  }
  return { apiVersion, contractMajor, contractMinor };
}

/** The committed manifest's stamps against the installed sdk's, as one line per number that differs. */
export function compatDifferences(
  manifest: Record<string, unknown>,
  installed: CompatVersions,
): string[] {
  const pairs: [string, unknown, string | number][] = [
    ["apiVersion", manifest.apiVersion, installed.apiVersion],
    ["contractMajor", manifest.contractMajor, installed.contractMajor],
    ["contractMinor", manifest.contractMinor, installed.contractMinor],
  ];
  return pairs
    .filter(([, committed, current]) => committed !== current)
    .map(
      ([name, committed, current]) =>
        `${name} is ${JSON.stringify(committed)} in the manifest and ${JSON.stringify(current)} in the installed sdk`,
    );
}

export interface ManifestRuleOptions {
  /** Where the installed sdk's stamps come from; replaced in tests. */
  compat?: (clientDir: string) => CompatVersions;
  /** What heals a stale stamp. */
  heal?: (clientDir: string) => void;
}

const manifestPathOf = (clientDir: string) =>
  join(clientDir, "gonogo-uplink.json");

export function compatRule(options: ManifestRuleOptions = {}): Rule {
  const compat = options.compat ?? installedCompat;
  const heal =
    options.heal ??
    ((clientDir: string) => {
      page(["--client", clientDir]);
    });
  return {
    id: "manifest/compat-stale",
    group: GROUP,
    check({ clientDir }: CheckContext): FixableFinding[] {
      if (!findUplinkDir(clientDir)) return [];
      const manifest = readJson(manifestPathOf(clientDir));
      if (!manifest) return [];
      const differences = compatDifferences(manifest, compat(clientDir));
      if (differences.length === 0) return [];
      return [
        {
          rule: "manifest/compat-stale",
          severity: "error",
          file: manifestPathOf(clientDir),
          line: 1,
          message: `The manifest was written against a different sdk than the one installed: ${differences.join("; ")}. The app judges a client by these numbers, so it would be refused or trusted wrongly.`,
          fixable: true,
          fix: "Run `uplink-tools page` and commit gonogo-uplink.json.",
          apply: () => heal(clientDir),
        },
      ];
    },
  };
}

/** The client's URL, declared version and committed manifest, which release judges together. */
export const releaseFaultsRule: Rule = {
  id: "manifest/release",
  group: GROUP,
  check({ clientDir }: CheckContext): FixableFinding[] {
    const uplinkDir = findUplinkDir(clientDir);
    if (!uplinkDir) return [];
    const declared = readJson(join(uplinkDir, "uplink.json"));
    const url = text(asRecord(declared?.client).url);
    const version = text(readJson(join(clientDir, "package.json"))?.version);
    const manifest = readJson(manifestPathOf(clientDir));
    const finding = (
      rule: string,
      severity: "error" | "warning",
      file: string,
      message: string,
      fix: string,
    ): FixableFinding => ({
      rule,
      severity,
      file,
      line: 1,
      message,
      fixable: false,
      fix,
    });
    const out: FixableFinding[] = [];
    const uplinkFile = join(uplinkDir, "uplink.json");
    const placeholder = placeholderUrlFault(url);
    if (placeholder) {
      out.push(
        finding(
          "manifest/placeholder-url",
          "warning",
          uplinkFile,
          placeholder,
          'Set "repo" and "client.url" in uplink.json to where the bundle will be published.',
        ),
      );
    }
    const wrongUrl = urlVersionFault(url, version);
    if (wrongUrl) {
      out.push(
        finding(
          "manifest/url-version",
          "error",
          uplinkFile,
          wrongUrl,
          "Move the version folder in client.url to the version in client/package.json.",
        ),
      );
    }
    const twoVersions = manifest
      ? declaredVersionFault(
          text(manifest.version),
          version,
          manifestPathOf(clientDir),
        )
      : undefined;
    if (twoVersions) {
      out.push(
        finding(
          "manifest/version",
          "error",
          manifestPathOf(clientDir),
          twoVersions,
          "Make defineUplinkClient's version and client/package.json's the same, then run `uplink-tools page`.",
        ),
      );
    }
    return out;
  },
};

export const manifestRules: readonly Rule[] = [compatRule(), releaseFaultsRule];
