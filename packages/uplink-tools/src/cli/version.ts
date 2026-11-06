/**
 * `uplink-tools version`: moves an Uplink to its next version in every place the
 * version is written, and regenerates the files that quote it.
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
import {
  type BumpLevel,
  levelOf,
  prependSection,
  readChanges,
  renderSection,
} from "./commits";
import { parseFlags } from "./flags";
import { page } from "./page";
import { versionsInUrlPath } from "./release";

export const VERSION_USAGE = `uplink-tools version [<version> | --bump <kind>] [options]

  Move the Uplink to its next version everywhere it is written: client/package.json,
  client/package-lock.json, the UPLINK_VERSION constant in client/src/uplink.ts and
  the version folder of client.url in uplink.json. Then write the page, which
  carries the version into README.md, gonogo-uplink.json and docs/spec.json.
  Nothing is committed. When any step fails every file is put back as it was.

  <version>        X.Y.Z or X.Y.Z-rc.N, above the current one
  --bump <kind>    patch, minor or major: the next full version. rc: the next
                   candidate of a version that is already one (1.0.0-rc.4 to
                   1.0.0-rc.5). auto: what --commits calls for, and on a
                   candidate, its next candidate with --rc or the release it
                   is a candidate for without
  --rc             make the result a candidate: 1.1.0-rc.1 from 1.0.0 with
                   --bump minor --rc
  --commits <file> the commits of this Uplink since its last release, as a JSON
                   array of subjects (or of { "subject", "breaking"? }). They
                   decide --bump auto, and they write this version's section
                   at the top of the Uplink's CHANGELOG.md. A breaking change
                   is major, a feat minor, a fix or perf patch
  --date <date>    the date the changelog section carries (default: today)
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
  from: string;
  to: string;
  /** The Uplink's `CHANGELOG.md` section, when commits were given. */
  changelog?: string;
  /** Every file the move wrote that exists afterwards, as absolute paths. */
  files: string[];
}

export interface VersionDeps {
  /** Writes the Uplink's generated page. */
  writePage?: (clientDir: string) => void;
  today?: () => string;
}

/**
 * Moves the Uplink holding `uplinkDir` to the version `request` names, in the
 * four places it is a source and then through `page` for the three that quote
 * it. Every file touched is put back when any step fails.
 */
export function moveVersion(
  uplinkDir: string,
  request: BumpRequest & { commits?: string; date?: string },
  deps: VersionDeps = {},
): VersionResult {
  const clientDir = join(uplinkDir, "client");
  const manifestFile = join(clientDir, "package.json");
  const lockFile = join(clientDir, "package-lock.json");
  const sourceFile = join(clientDir, "src", "uplink.ts");
  const declarationFile = join(uplinkDir, "uplink.json");
  for (const file of [manifestFile, sourceFile, declarationFile]) {
    if (!existsSync(file)) {
      throw new Error(
        `${file} does not exist, and it is one of the places an Uplink's version is written`,
      );
    }
  }

  const manifestText = readFileSync(manifestFile, "utf8");
  const manifest = JSON.parse(manifestText);
  const from = asString(Reflect.get(Object(manifest), "version"));
  if (!from) throw new Error(`${manifestFile} carries no version`);
  const declaration: unknown = JSON.parse(
    readFileSync(declarationFile, "utf8"),
  );
  const id = asString(Reflect.get(Object(declaration), "id"));
  const changes = request.commits ? readChanges(request.commits) : undefined;
  const to = nextVersion(from, {
    ...request,
    level: changes ? levelOf(changes) : undefined,
  });

  const declarationText = readFileSync(declarationFile, "utf8");
  const url = asString(
    Reflect.get(Object(Reflect.get(Object(declaration), "client")), "url"),
  );
  if (url) {
    const named = versionsInUrlPath(url);
    if (named.length !== 1 || named[0] !== from) {
      throw new Error(
        `uplink.json's client.url (${url}) must carry the current version ${from} as one folder of its path, so it can move with the version. ${named.length === 0 ? "It names none." : `It names ${named.join(" and ")}.`}`,
      );
    }
  }
  const sourceText = readFileSync(sourceFile, "utf8");
  const declarations = [...sourceText.matchAll(UPLINK_VERSION_DECLARATION)];
  if (declarations.length !== 1 || declarations[0][2] !== from) {
    throw new Error(
      `${sourceFile} must declare const UPLINK_VERSION = "${from}" exactly once, the one place the client says its version. It has ${declarations.length === 0 ? "none" : declarations.map((d) => `"${d[2]}"`).join(" and ")}.`,
    );
  }

  const outputs = [
    join(uplinkDir, "README.md"),
    join(clientDir, "gonogo-uplink.json"),
    join(clientDir, "docs", "widgets.json"),
    join(clientDir, "docs", "spec.json"),
    join(uplinkDir, "CHANGELOG.md"),
  ];
  const touched = [
    manifestFile,
    lockFile,
    sourceFile,
    declarationFile,
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
        declarationText.replace(url, url.replace(`/${from}/`, `/${to}/`)),
      );
    }

    (deps.writePage ?? writeThePage)(clientDir);

    let section: string | undefined;
    if (changes) {
      const date = request.date ?? (deps.today ?? today)();
      section = renderSection(to, date, changes);
      prependSection(uplinkDir, to, section);
    }
    return {
      id,
      from,
      to,
      changelog: section,
      files: touched.filter((file) => existsSync(file)),
    };
  } catch (err) {
    restore();
    throw err;
  }
}

const today = () => new Date().toISOString().slice(0, 10);

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
    values: ["--bump", "--commits", "--date", "--uplink"],
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
      date: values.get("--date"),
    },
    deps,
  );
  console.log(`${result.id}: ${result.from} -> ${result.to}`);
  return 0;
}
