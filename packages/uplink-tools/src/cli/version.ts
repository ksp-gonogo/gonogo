/**
 * `uplink-tools version`: stamps an Uplink with the version a release gives it in
 * every place the version is written, and regenerates the files that quote it.
 *
 * What an Uplink's repository commits is the placeholder, never a release. The
 * real version is written into a release checkout that is thrown away.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findUplinkDir } from "./bake";
import { type BumpLevel, levelOf, readChanges } from "./commits";
import { parseFlags } from "./flags";
import { page } from "./page";
import { versionsInUrlPath } from "./release";

/**
 * The version every Uplink carries in its committed files. A release writes the
 * real one over it in a throwaway checkout and never commits the result.
 */
export const PLACEHOLDER_VERSION = "0.0.0-development";

export const VERSION_USAGE = `uplink-tools version [<version> | --bump <kind> --from <version>] [options]

  Stamp the Uplink with its release version everywhere it is written:
  client/package.json, client/package-lock.json, the UPLINK_VERSION constant in
  client/src/uplink.ts and the version folder of client.url in uplink.json. Then
  write the page, which carries the version into README.md, gonogo-uplink.json
  and docs/spec.json. The committed files hold ${PLACEHOLDER_VERSION}; run this in a
  checkout that is not committed back. Nothing is committed. When any step
  fails every file is put back as it was.

  An Uplink with no client directory (a mod-only Uplink) commits its version
  nowhere but in the package.json of its types-only package, when it has one: the
  plugin takes it from the release tag. For one, this works out the version,
  checks it sorts above --from, and stamps that package. An Uplink with a client
  and a types/ package has that stamped too.

  <version>        X.Y.Z or X.Y.Z-rc.N. Above --from when that is given
  --from <version> the Uplink's latest released version, the one its newest
                   tag <id>-v<version> names. --bump works from it
  --bump <kind>    patch, minor or major: the next full version. rc: the next
                   candidate of a version that is already one (1.0.0-rc.4 to
                   1.0.0-rc.5). auto: what --commits calls for, and on a
                   candidate, its next candidate with --rc or the release it
                   is a candidate for without
  --rc             make the result a candidate: 1.1.0-rc.1 from 1.0.0 with
                   --bump minor --rc
  --commits <file> the commits of this Uplink since its last release, as a JSON
                   array of subjects (or of { "subject", "breaking"? }). They
                   decide --bump auto: a breaking change is major, a feat
                   minor, a fix or perf patch
  --uplink <dir>   the Uplink's directory, the one holding uplink.json
                   (default: found by walking up from the current directory)`;

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** The candidate number, absent on a full release. */
  rc?: number;
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/;

export function parseVersion(text: string): Version {
  const match = VERSION.exec(text);
  if (!match) {
    throw new Error(
      `${text} is not a version this command writes. A version is X.Y.Z or X.Y.Z-rc.N, such as 1.2.0 or 1.2.0-rc.1.`,
    );
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    rc: match[4] === undefined ? undefined : Number(match[4]),
  };
}

export const versionText = (v: Version): string =>
  `${v.major}.${v.minor}.${v.patch}${v.rc === undefined ? "" : `-rc.${v.rc}`}`;

/** Negative when `a` sorts below `b`: a candidate sorts below the release it is for. */
export function compareVersions(a: Version, b: Version): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.rc === b.rc) return 0;
  if (a.rc === undefined) return 1;
  if (b.rc === undefined) return -1;
  return a.rc - b.rc;
}

export interface BumpRequest {
  explicit?: string;
  bump?: string;
  rc: boolean;
  /** What the commits call for, read only for `auto`. */
  level?: BumpLevel;
}

const BUMPS = ["patch", "minor", "major", "rc", "auto"];

const raise = (current: Version, level: BumpLevel): Version => ({
  major: current.major + (level === "major" ? 1 : 0),
  minor: level === "major" ? 0 : current.minor + (level === "minor" ? 1 : 0),
  patch: level === "patch" ? current.patch + 1 : 0,
});

const coreOf = (v: Version): Version => ({
  major: v.major,
  minor: v.minor,
  patch: v.patch,
});

const nextCandidate = (v: Version): Version => ({
  ...coreOf(v),
  rc: (v.rc ?? 0) + 1,
});

/** The version a request that names none moves `current` to, or the reason it cannot. */
function bumped(current: Version, request: BumpRequest): Version {
  const text = versionText(current);
  const candidate = current.rc !== undefined;
  if (request.bump === undefined) {
    throw new Error(
      `version needs the version to move to, or --bump <${BUMPS.join("|")}>\n\n${VERSION_USAGE}`,
    );
  }
  if (!BUMPS.includes(request.bump)) {
    throw new Error(
      `--bump takes ${BUMPS.join(", ")}, and "${request.bump}" is none of them`,
    );
  }
  if (request.bump === "rc") {
    if (candidate) return nextCandidate(current);
    throw new Error(
      `${text} is a full release, so there is no next candidate of it. Say what the candidate is for: --bump patch --rc, --bump minor --rc or --bump major --rc.`,
    );
  }
  if (request.bump === "auto" && candidate) {
    return request.rc ? nextCandidate(current) : coreOf(current);
  }
  if (candidate) {
    throw new Error(
      `${text} is a candidate for ${versionText(coreOf(current))}, so --bump ${request.bump} has nothing to add to it. Release it by naming ${versionText(coreOf(current))}, or cut the next candidate with --bump rc.`,
    );
  }
  const level = request.bump === "auto" ? request.level : request.bump;
  if (level !== "major" && level !== "minor" && level !== "patch") {
    throw new Error(
      "--bump auto found nothing in the commits that reaches a release: a breaking change, a feat, a fix or a perf. Name the version, or pass --bump patch if it should go anyway.",
    );
  }
  const next = raise(current, level);
  return request.rc ? { ...next, rc: 1 } : next;
}

/** The version the request moves `currentText` to, or the reason it cannot. */
export function nextVersion(currentText: string, request: BumpRequest): string {
  const current = parseVersion(currentText);
  if (
    request.explicit !== undefined &&
    (request.bump !== undefined || request.rc)
  ) {
    throw new Error(
      "name a version, or use --bump and --rc: the version already says whether it is a candidate",
    );
  }
  const next =
    request.explicit === undefined
      ? bumped(current, request)
      : parseVersion(request.explicit);
  if (compareVersions(next, current) <= 0) {
    throw new Error(
      `${versionText(next)} does not sort above the current ${currentText}`,
    );
  }
  return versionText(next);
}

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** Writes JSON back the way it was indented, with a closing newline. */
function writeJson(file: string, text: string, value: unknown): void {
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
  writeFileSync(file, `${JSON.stringify(value, null, indent)}\n`);
}

const UPLINK_VERSION_DECLARATION = /^(const UPLINK_VERSION = ")([^"]*)(")/gm;

export interface VersionResult {
  id: string;
  /** The version the stamp moved above: `--from`, or the placeholder when none was given. */
  from: string;
  to: string;
  /** Every file the move wrote that exists afterwards, as absolute paths. */
  files: string[];
}

export interface VersionDeps {
  /** Writes the Uplink's generated page. */
  writePage?: (clientDir: string) => void;
}

/**
 * The version `request` stamps: the one it names, or the next one above
 * `request.from`. With no `from` only an explicit version can be stamped.
 */
export function targetVersion(
  request: BumpRequest & { from?: string },
): string {
  if (request.from !== undefined) return nextVersion(request.from, request);
  if (request.explicit === undefined) {
    throw new Error(
      "--bump moves above the Uplink's latest released version, so it needs --from <version>: the version of its newest tag. Or name the version to stamp.",
    );
  }
  if (request.bump !== undefined || request.rc) {
    throw new Error(
      "name a version, or use --bump and --rc: the version already says whether it is a candidate",
    );
  }
  return versionText(parseVersion(request.explicit));
}

/** Writes `to` into the types-only package's manifest when the Uplink has one, and returns the files it wrote. */
function stampTypesPackage(uplinkDir: string, to: string): string[] {
  const manifestFile = join(uplinkDir, "types", "package.json");
  if (!existsSync(manifestFile)) return [];
  const text = readFileSync(manifestFile, "utf8");
  const manifest = JSON.parse(text);
  manifest.version = to;
  writeJson(manifestFile, text, manifest);
  return [manifestFile];
}

/**
 * The move for an Uplink with no client half. Its version is written in no
 * committed file: the plugin takes it from the release tag at build time, so
 * the move only works out the version and stamps the types package if there is one.
 */
function modOnlyMove(
  uplinkDir: string,
  request: BumpRequest & { commits?: string; from?: string },
): VersionResult {
  const declarationFile = join(uplinkDir, "uplink.json");
  if (!existsSync(declarationFile)) {
    throw new Error(
      `${declarationFile} does not exist, and it is what makes a directory an Uplink`,
    );
  }
  const declaration: unknown = JSON.parse(
    readFileSync(declarationFile, "utf8"),
  );
  const changes = request.commits ? readChanges(request.commits) : undefined;
  const to = targetVersion({
    ...request,
    level: changes ? levelOf(changes) : undefined,
  });
  // The one file such an Uplink commits a version in, when it has the types-only package.
  const files = stampTypesPackage(uplinkDir, to);
  return {
    id: asString(Reflect.get(Object(declaration), "id")),
    from: request.from ?? PLACEHOLDER_VERSION,
    to,
    files,
  };
}

/**
 * Stamps the Uplink holding `uplinkDir` with the version `request` names, in
 * the four places it is a source and then through `page` for the three that
 * quote it. Every file touched is put back when any step fails.
 */
export function moveVersion(
  uplinkDir: string,
  request: BumpRequest & { commits?: string; from?: string },
  deps: VersionDeps = {},
): VersionResult {
  const clientDir = join(uplinkDir, "client");
  const manifestFile = join(clientDir, "package.json");
  const lockFile = join(clientDir, "package-lock.json");
  const sourceFile = join(clientDir, "src", "uplink.ts");
  const declarationFile = join(uplinkDir, "uplink.json");
  if (!existsSync(clientDir)) return modOnlyMove(uplinkDir, request);
  for (const file of [manifestFile, sourceFile, declarationFile]) {
    if (!existsSync(file)) {
      throw new Error(
        `${file} does not exist, and it is one of the places an Uplink's version is written`,
      );
    }
  }

  const manifestText = readFileSync(manifestFile, "utf8");
  const manifest = JSON.parse(manifestText);
  const committed = asString(Reflect.get(Object(manifest), "version"));
  if (!committed) throw new Error(`${manifestFile} carries no version`);
  const declaration: unknown = JSON.parse(
    readFileSync(declarationFile, "utf8"),
  );
  const id = asString(Reflect.get(Object(declaration), "id"));
  const changes = request.commits ? readChanges(request.commits) : undefined;
  const to = targetVersion({
    ...request,
    level: changes ? levelOf(changes) : undefined,
  });

  const declarationText = readFileSync(declarationFile, "utf8");
  const url = asString(
    Reflect.get(Object(Reflect.get(Object(declaration), "client")), "url"),
  );
  if (url) {
    const named = versionsInUrlPath(url);
    if (named.length !== 1 || named[0] !== committed) {
      throw new Error(
        `uplink.json's client.url (${url}) must carry the current version ${committed} as one folder of its path, so it can move with the version. ${named.length === 0 ? "It names none." : `It names ${named.join(" and ")}.`}`,
      );
    }
  }
  const sourceText = readFileSync(sourceFile, "utf8");
  const declarations = [...sourceText.matchAll(UPLINK_VERSION_DECLARATION)];
  if (declarations.length !== 1 || declarations[0][2] !== committed) {
    throw new Error(
      `${sourceFile} must declare const UPLINK_VERSION = "${committed}" exactly once, the one place the client says its version. It has ${declarations.length === 0 ? "none" : declarations.map((d) => `"${d[2]}"`).join(" and ")}.`,
    );
  }

  const outputs = [
    join(uplinkDir, "README.md"),
    join(clientDir, "gonogo-uplink.json"),
    join(clientDir, "docs", "widgets.json"),
    join(clientDir, "docs", "spec.json"),
  ];
  const touched = [
    manifestFile,
    lockFile,
    sourceFile,
    declarationFile,
    join(uplinkDir, "types", "package.json"),
    ...outputs,
  ];
  const snapshot = new Map(
    touched.map((file) => [
      file,
      existsSync(file) ? readFileSync(file, "utf8") : undefined,
    ]),
  );
  const restore = () => {
    for (const [file, text] of snapshot) {
      if (text === undefined) rmSync(file, { force: true });
      else {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, text);
      }
    }
  };

  try {
    manifest.version = to;
    writeJson(manifestFile, manifestText, manifest);

    const lockText = snapshot.get(lockFile);
    if (lockText !== undefined) {
      const lock = JSON.parse(lockText);
      lock.version = to;
      if (lock.packages?.[""]) lock.packages[""].version = to;
      writeJson(lockFile, lockText, lock);
    }

    writeFileSync(
      sourceFile,
      sourceText.replace(
        UPLINK_VERSION_DECLARATION,
        (_all, open: string, _old: string, close: string) =>
          `${open}${to}${close}`,
      ),
    );

    if (url) {
      writeFileSync(
        declarationFile,
        declarationText.replace(url, url.replace(`/${committed}/`, `/${to}/`)),
      );
    }

    stampTypesPackage(uplinkDir, to);

    (deps.writePage ?? writeThePage)(clientDir);

    return {
      id,
      from: request.from ?? committed,
      to,
      files: touched.filter((file) => existsSync(file)),
    };
  } catch (err) {
    restore();
    throw err;
  }
}

function writeThePage(clientDir: string): void {
  page(["--client", clientDir], dirname(clientDir));
}

export function version(
  argv: readonly string[],
  cwd: string = process.cwd(),
  deps: VersionDeps = {},
): number {
  const { values, switches, positionals } = parseFlags(argv, {
    verb: "version",
    usage: VERSION_USAGE,
    values: ["--bump", "--commits", "--from", "--uplink"],
    switches: ["--rc"],
    positionals: 1,
  });
  const named = values.get("--uplink");
  const uplinkDir = named ? resolve(cwd, named) : findUplinkDir(cwd);
  if (!uplinkDir) {
    throw new Error(
      `no uplink.json in ${cwd} or any directory above it. Run version inside an Uplink, or name one with --uplink <dir>.`,
    );
  }
  const commits = values.get("--commits");
  const result = moveVersion(
    uplinkDir,
    {
      explicit: positionals[0],
      bump: values.get("--bump"),
      rc: switches.has("--rc"),
      commits: commits ? resolve(cwd, commits) : undefined,
      from: values.get("--from"),
    },
    deps,
  );
  console.log(`${result.id}: ${result.from} -> ${result.to}`);
  return 0;
}
