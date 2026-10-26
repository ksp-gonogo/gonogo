/**
 * `uplink-tools deps bump`: moves an Uplink's pins to the newest release its
 * channels list, regenerates what quotes them, runs every check and says
 * whether any of them touched the new bytes.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  ckanSpelling,
  type Http,
  type ModChannel,
  parseChannels,
} from "./channels";
import {
  asRecord,
  buildReport,
  type Dependency,
  type ReportOptions,
  readJsonFile,
} from "./report";
import { isPrerelease } from "./version";

export type CheckName =
  | "codegen"
  | "check"
  | "typecheck"
  | "tests"
  | "build"
  | "mod-tests"
  | "docs";

export const CHECK_NAMES: readonly CheckName[] = [
  "codegen",
  "check",
  "typecheck",
  "tests",
  "build",
  "mod-tests",
  "docs",
];

export interface RunResult {
  status: number;
  output: string;
}

/** Runs a command to completion; replaceable so a test runs no process. */
export type Runner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
) => RunResult;

export const spawnRunner: Runner = (command, args, { cwd, env }) => {
  const ran = spawnSync(command, [...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (ran.error) return { status: 127, output: String(ran.error.message) };
  return { status: ran.status ?? 1, output: `${ran.stdout}${ran.stderr}` };
};

export interface BumpCheck {
  name: CheckName;
  status: "pass" | "fail" | "skipped";
  log?: string;
  excerpt?: string;
}

export interface BumpEntry {
  name: string;
  from: string | null;
  to: string;
  binds: string;
  url: string | null;
  /** The mod's version as CKAN spells it, which is what a relationship's `min_version` carries. */
  ckanMinVersion?: string;
}

export interface BumpResult {
  schema: "uplink-bump/1";
  uplink: string;
  bumps: BumpEntry[];
  changed: string[];
  checks: BumpCheck[];
  exercised: Record<string, string>;
  reference: Record<string, string>;
  verdict: "green" | "red" | "unverified";
}

export interface BumpOptions extends ReportOptions {
  names: readonly string[];
  to?: string;
  gamedata?: string;
  /** Where the downloaded release of each bumped mod is copied, for a reference set kept elsewhere. */
  referenceOut?: string;
  skip: readonly CheckName[];
  /** Where the check logs are written. */
  logDir: string;
  run?: Runner;
  /** The command that runs `uplink-tools`, as the process and its leading arguments. */
  self?: readonly string[];
}

export class BumpError extends Error {}

const detectIndent = (text: string): string =>
  /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";

const writeJson = (file: string, original: string, value: unknown) =>
  writeFileSync(
    file,
    `${JSON.stringify(value, null, detectIndent(original))}\n`,
  );

const excerptOf = (output: string): string =>
  output.trimEnd().split("\n").slice(-15).join("\n");

function chooseTargets(
  dependencies: readonly Dependency[],
  options: BumpOptions,
): Dependency[] {
  if (options.names.length === 0) {
    const behind = dependencies.filter(
      (d) => d.state === "behind" && !d.reportOnly,
    );
    if (options.to !== undefined && behind.length !== 1) {
      throw new BumpError(
        "--to names one version, so it needs exactly one dependency to move",
      );
    }
    return behind;
  }
  const targets = options.names.map((name) => {
    const found = dependencies.find(
      (d) => d.name.toLowerCase() === name.toLowerCase(),
    );
    if (!found) {
      throw new BumpError(
        `no dependency named "${name}". This Uplink pins: ${dependencies.map((d) => d.name).join(", ")}`,
      );
    }
    if (found.reportOnly) {
      throw new BumpError(
        `${found.name} is one of gonogo's own packages. They are reported and never bumped here: they move together with a re-vendor of the reference set.`,
      );
    }
    if (found.state !== "behind" && options.to === undefined) {
      throw new BumpError(
        `${found.name} is ${found.state}, so there is nothing to bump it to`,
      );
    }
    return found;
  });
  if (options.to !== undefined && targets.length !== 1) {
    throw new BumpError(
      "--to names one version, so it needs exactly one dependency to move",
    );
  }
  return targets;
}

/**
 * Downloads the release archive a mod's channel names and unpacks it. The files
 * are copied to `referenceOut` when one is given, and laid over a copy of
 * `gamedata` when the mod is compiled against, which is what the build then
 * reads. The folder passed in is never written.
 */
async function fetchReference(
  target: Dependency,
  where: { gamedata?: string; referenceOut?: string },
  scratch: string,
  http: Http,
  run: Runner,
): Promise<{ gamedata?: string; note: string }> {
  const download = target.answer?.download;
  if (!download) {
    return {
      gamedata: where.gamedata,
      note: "unavailable: the channel names no archive to download",
    };
  }
  const zip = join(scratch, "reference.zip");
  writeFileSync(zip, await http.bytes(download));
  const unpacked = join(scratch, "unpacked");
  rmSync(unpacked, { recursive: true, force: true });
  mkdirSync(unpacked, { recursive: true });
  const unzipped = run("unzip", ["-q", "-o", zip, "-d", unpacked], {
    cwd: scratch,
  });
  if (unzipped.status !== 0) {
    return {
      gamedata: where.gamedata,
      note: `unavailable: ${download} did not unpack`,
    };
  }
  const root = existsSync(join(unpacked, "GameData"))
    ? join(unpacked, "GameData")
    : unpacked;
  if (where.referenceOut) {
    mkdirSync(where.referenceOut, { recursive: true });
    for (const entry of readdirSync(root)) {
      cpSync(join(root, entry), join(where.referenceOut, entry), {
        recursive: true,
      });
    }
  }
  let gamedata = where.gamedata;
  if (gamedata && target.binds === "compile") {
    const layered = join(scratch, "GameData");
    cpSync(gamedata, layered, { recursive: true });
    for (const entry of readdirSync(root)) {
      cpSync(join(root, entry), join(layered, entry), { recursive: true });
    }
    gamedata = layered;
  }
  return { gamedata, note: `downloaded ${download}` };
}

function outcomeOf(
  name: CheckName,
  ran: RunResult,
  log: string,
  noBrowser: boolean,
): BumpCheck {
  if (noBrowser) return { name, status: "skipped", log };
  if (ran.status === 0) return { name, status: "pass", log };
  return { name, status: "fail", log, excerpt: excerptOf(ran.output) };
}

/** The files a bump may write, relative to the Uplink, that exist. */
const TOUCHED = [
  "uplink.json",
  "README.md",
  "CHANGELOG.md",
  "client/package.json",
  "client/package-lock.json",
  "client/gonogo-uplink.json",
  "client/docs/widgets.json",
  "client/docs/spec.json",
];

/** Applies the bump, runs the checks and returns the result and the exit code it earns. */
export async function bumpDependencies(
  options: BumpOptions,
): Promise<{ result: BumpResult; exit: number }> {
  const { uplinkDir, http } = options;
  const run = options.run ?? spawnRunner;
  const self = options.self ?? [process.execPath, process.argv[1]];
  const clientDir = join(uplinkDir, "client");
  const hasClient = existsSync(join(clientDir, "package.json"));
  const workDir = hasClient ? clientDir : uplinkDir;
  const report = await buildReport(options);
  const targets = chooseTargets(report.dependencies, options);

  const result: BumpResult = {
    schema: "uplink-bump/1",
    uplink: report.uplink,
    bumps: [],
    changed: [],
    checks: [],
    exercised: {},
    reference: {},
    verdict: "green",
  };
  if (targets.length === 0) return { result, exit: 0 };

  const versionOf = (target: Dependency): string => {
    const version = options.to ?? target.newest;
    if (!version)
      throw new BumpError(`${target.name} has no newest release to move to`);
    if (isPrerelease(version)) {
      throw new BumpError(
        `${version} is a prerelease. A prerelease is never a pin on main; try one on staging by editing the pin by hand.`,
      );
    }
    return version;
  };

  const snapshot = new Map(
    TOUCHED.map((file) => {
      const path = join(uplinkDir, file);
      return [
        path,
        existsSync(path) ? readFileSync(path, "utf8") : undefined,
      ] as const;
    }),
  );
  const restore = () => {
    for (const [path, text] of snapshot) {
      if (text === undefined) rmSync(path, { force: true });
      else writeFileSync(path, text);
    }
  };

  const uplinkFile = join(uplinkDir, "uplink.json");
  try {
    for (const target of targets) {
      const to = versionOf(target);
      const entry: BumpEntry = {
        name: target.name,
        from: target.pinned,
        to,
        binds: target.binds,
        url: target.answer?.url ?? null,
      };
      const text = readFileSync(uplinkFile, "utf8");
      const uplink = readJsonFile(uplinkFile);
      if (target.kind === "mod") {
        const mod = asRecord(uplink.mod);
        mod.builtAgainst = to;
        const ckan = parseChannels(mod.channels, "mod.channels").channels.find(
          (c): c is Extract<ModChannel, { ckan: string }> => "ckan" in c,
        );
        if (ckan) {
          const spelled =
            target.answer?.ckanVersion && target.answer.version === to
              ? target.answer.ckanVersion
              : await ckanSpelling(ckan.ckan, to, http);
          if (spelled) {
            mod.ckanVersion = spelled;
            entry.ckanMinVersion = spelled;
          } else {
            delete mod.ckanVersion;
          }
        }
        for (const name of target.packages ?? []) {
          const manifestFile = join(clientDir, "package.json");
          const manifestText = readFileSync(manifestFile, "utf8");
          const manifest = readJsonFile(manifestFile);
          for (const block of ["dependencies", "devDependencies"]) {
            const deps = asRecord(manifest[block]);
            if (name in deps) deps[name] = to;
          }
          writeJson(manifestFile, manifestText, manifest);
        }
      }
      if (target.kind === "ckan-dependency") {
        const list = Array.isArray(uplink.ckanDepends)
          ? uplink.ckanDepends.map(asRecord)
          : [];
        const found = list.find((d) => d.name === target.name);
        if (found) found.min_version = target.answer?.ckanVersion ?? to;
      }
      writeJson(uplinkFile, text, uplink);
      result.bumps.push(entry);
    }

    if (hasClient && targets.some((t) => (t.packages ?? []).length > 0)) {
      const installed = run("npm", ["install", "--no-audit", "--no-fund"], {
        cwd: clientDir,
      });
      if (installed.status !== 0) {
        throw new BumpError(
          `npm install failed:\n${excerptOf(installed.output)}`,
        );
      }
    }
    const paged = run(self[0], [...self.slice(1), "page"], { cwd: workDir });
    if (paged.status !== 0) {
      throw new BumpError(`page failed:\n${excerptOf(paged.output)}`);
    }
  } catch (err) {
    restore();
    throw err;
  }

  for (const [path, before] of snapshot) {
    const after = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    if (after !== before) result.changed.push(relative(uplinkDir, path));
  }

  const scratch = mkdtempSync(join(tmpdir(), "uplink-deps-"));
  let gamedata = options.gamedata ?? process.env.KspGameData;
  try {
    for (const target of targets) {
      if (target.kind !== "mod") continue;
      const compiles = target.binds === "compile";
      if (compiles && !gamedata && !options.referenceOut) {
        result.reference[target.name] =
          "unavailable: no GameData to build against; pass --gamedata";
        continue;
      }
      if (!compiles && !options.referenceOut) continue;
      try {
        const fetched = await fetchReference(
          target,
          {
            gamedata: gamedata ? resolve(gamedata) : undefined,
            referenceOut: options.referenceOut,
          },
          scratch,
          http,
          run,
        );
        gamedata = fetched.gamedata;
        result.reference[target.name] = fetched.note;
      } catch (err) {
        result.reference[target.name] =
          `unavailable: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    mkdirSync(options.logDir, { recursive: true });
    const skip = new Set(options.skip);
    const hasScript = (script: string): boolean => {
      const file = join(clientDir, "package.json");
      if (!hasClient) return false;
      return asRecord(readJsonFile(file).scripts)[script] !== undefined;
    };
    const csprojIn = (dir: string): string | undefined =>
      existsSync(dir)
        ? readdirSync(dir).find((entry) => entry.endsWith(".csproj"))
        : undefined;
    const modProject = csprojIn(join(uplinkDir, "mod"));
    const testProject = csprojIn(join(uplinkDir, "mod-tests"));
    const hasCodegen = readJsonFile(uplinkFile).codegen !== undefined;
    const env = gamedata ? { KspGameData: gamedata } : undefined;
    const dotnetProps = gamedata ? [`-p:KspGameData=${gamedata}`] : [];
    const needsGamedata = targets.some(
      (t) => t.kind === "mod" && t.binds === "compile",
    );

    const plan: {
      name: CheckName;
      applies: boolean;
      command: string;
      args: string[];
      cwd: string;
    }[] = [
      {
        name: "codegen",
        applies: hasCodegen,
        command: self[0],
        args: [...self.slice(1), "codegen", "--check"],
        cwd: workDir,
      },
      {
        name: "check",
        applies: true,
        command: self[0],
        args: [...self.slice(1), "check"],
        cwd: workDir,
      },
      {
        name: "typecheck",
        applies: hasScript("typecheck"),
        command: "npm",
        args: ["run", "typecheck"],
        cwd: clientDir,
      },
      {
        name: "tests",
        applies: hasScript("test"),
        command: "npm",
        args: ["test"],
        cwd: clientDir,
      },
      {
        name: "build",
        applies: modProject !== undefined,
        command: "dotnet",
        args: [
          "build",
          join(uplinkDir, "mod", modProject ?? ""),
          "-c",
          "Release",
          ...dotnetProps,
        ],
        cwd: uplinkDir,
      },
      {
        name: "mod-tests",
        applies: testProject !== undefined,
        command: "dotnet",
        args: [
          "test",
          join(uplinkDir, "mod-tests", testProject ?? ""),
          ...dotnetProps,
        ],
        cwd: uplinkDir,
      },
      {
        name: "docs",
        applies: hasClient,
        command: self[0],
        args: [...self.slice(1), "docs", "--check"],
        cwd: workDir,
      },
    ];
    for (const step of plan) {
      if (!step.applies || skip.has(step.name)) {
        result.checks.push({ name: step.name, status: "skipped" });
        continue;
      }
      if (step.name === "build" && needsGamedata && !gamedata) {
        result.checks.push({ name: step.name, status: "skipped" });
        continue;
      }
      const ran = run(step.command, step.args, { cwd: step.cwd, env });
      const log = join(options.logDir, `${step.name}.log`);
      writeFileSync(log, ran.output);
      const noBrowser =
        step.name === "docs" &&
        /Executable doesn't exist|playwright install|browserType\.launch/.test(
          ran.output,
        );
      result.checks.push(outcomeOf(step.name, ran, log, noBrowser));
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const passed = (name: CheckName) =>
    result.checks.some((c) => c.name === name && c.status === "pass");
  for (const target of targets) {
    const ran: string[] = [];
    if (target.kind === "mod") {
      if (
        target.binds === "compile" &&
        passed("build") &&
        !result.reference[target.name]?.startsWith("unavailable")
      ) {
        ran.push("compiled");
      }
      if (
        (target.packages ?? []).length > 0 &&
        (passed("typecheck") || passed("tests"))
      ) {
        ran.push("types and tests");
      }
    }
    const to = options.to ?? target.newest;
    result.exercised[target.name] =
      ran.length > 0 ? ran.join(", ") : `nothing ran against ${to}`;
  }

  const failed = result.checks.some((c) => c.status === "fail");
  const unexercised = Object.values(result.exercised).some((e) =>
    e.startsWith("nothing"),
  );
  result.verdict = failed ? "red" : unexercised ? "unverified" : "green";
  const exit =
    result.verdict === "green" ? 0 : result.verdict === "red" ? 1 : 3;
  return { result, exit };
}

export const resultJson = (result: BumpResult): string =>
  `${JSON.stringify(result, null, 2)}\n`;

export function writeResult(file: string, result: BumpResult): void {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, resultJson(result));
}
