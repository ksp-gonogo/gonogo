/**
 * `uplink-tools release prepare`: stamps an Uplink with the version it is
 * released as and proves that release builds, in a checkout that is discarded.
 *
 * Nothing is committed, tagged or pushed. The tag that names the release is made
 * on the commit that passed, after this command, by the workflow that runs it.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findUplinkDir } from "./bake";
import { levelOf, readChanges } from "./commits";
import { parseFlags } from "./flags";
import { moveVersion, targetVersion, type VersionDeps } from "./version";

export const PREPARE_USAGE = `uplink-tools release prepare [options]

  Stamp the Uplink with the version it is released as and prove the release
  builds. In order, stopping at the first failure:

    1. the tree is clean and the tag <id>-v<version> is unspent here and on origin
    2. version: every place the version is written, and the page
    3. codegen --check, check, the client's tests, docs --check
    4. release, into a scratch folder: the exact bundle, bake, compile and zip
       a published release is rebuilt from

  The stamped files are left in the tree for the build that follows, and the
  tree is not committed: run this in a checkout that is thrown away. A failure
  at any step puts every file back as it was.

  --version <v>     the version to stamp, X.Y.Z or X.Y.Z-rc.N
  --from <v>        the Uplink's latest released version, the one its newest tag
                    names. --bump works from it
  --bump <kind>     patch, minor, major, rc or auto, as version takes them
  --rc              make the result a candidate, as version takes it
  --commits <file>  the Uplink's commits since its last release, as version takes
                    them: they decide --bump auto
  --uplink <dir>    the Uplink's directory, the one holding uplink.json
                    (default: found by walking up from the current directory)`;

export interface PrepareDeps extends VersionDeps {
  /** Runs an `uplink-tools` command from `cwd`, as an author would, and returns its exit code. */
  run: (argv: readonly string[], cwd: string) => Promise<number>;
  /** Runs the client's own tests. */
  runTests?: (clientDir: string) => boolean;
}

export interface PrepareResult {
  id: string;
  version: string;
  tag: string;
}

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const ran = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    ok: ran.status === 0,
    out: `${ran.stdout ?? ""}${ran.stderr ?? ""}`.trim(),
  };
}

function mustGit(cwd: string, args: string[]): string {
  const ran = git(cwd, args);
  if (!ran.ok) throw new Error(`git ${args.join(" ")} failed:\n${ran.out}`);
  return ran.out;
}

function clientTests(clientDir: string): boolean {
  const ran = spawnSync("npm", ["test"], {
    cwd: clientDir,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
    shell: process.platform === "win32",
  });
  return ran.status === 0;
}

/**
 * Puts the Uplink back as the clean tree it started as: tracked files as
 * committed, and the files the move created gone.
 */
function revert(
  repo: string,
  uplinkDir: string,
  moved: readonly string[],
): void {
  git(repo, ["reset", "-q"]);
  git(repo, ["checkout", "HEAD", "--", uplinkDir]);
  for (const file of moved) {
    if (!git(repo, ["ls-files", "--error-unmatch", "--", file]).ok) {
      rmSync(file, { force: true });
    }
  }
}

/** Runs this same `uplink-tools` as a child process, so a command that reads the working directory sees the one it is given. */
export function runCli(argv: readonly string[], cwd: string): Promise<number> {
  const ran = spawnSync(process.execPath, [process.argv[1], ...argv], {
    cwd,
    stdio: "inherit",
  });
  return Promise.resolve(ran.status ?? 1);
}

export async function prepareRelease(
  argv: readonly string[],
  deps: PrepareDeps,
  cwd: string = process.cwd(),
): Promise<PrepareResult> {
  const { values, switches } = parseFlags(argv, {
    verb: "release prepare",
    usage: PREPARE_USAGE,
    values: ["--version", "--from", "--bump", "--commits", "--uplink"],
    switches: ["--rc"],
  });
  const named = values.get("--uplink");
  const uplinkDir = named ? resolve(cwd, named) : findUplinkDir(cwd);
  if (!uplinkDir) {
    throw new Error(
      `no uplink.json in ${cwd} or any directory above it. Run release prepare inside an Uplink, or name one with --uplink <dir>.`,
    );
  }
  const clientDir = join(uplinkDir, "client");
  const run = (args: readonly string[]) => deps.run(args, clientDir);
  const read = (file: string): unknown =>
    JSON.parse(readFileSync(file, "utf8"));
  const str = (value: unknown, key: string): string => {
    const found = Reflect.get(Object(value), key);
    return typeof found === "string" ? found : "";
  };
  const id = str(read(join(uplinkDir, "uplink.json")), "id");
  const clientUrl = Reflect.get(
    Object(Reflect.get(Object(read(join(uplinkDir, "uplink.json"))), "client")),
    "url",
  );
  const hasClientUrl = typeof clientUrl === "string" && clientUrl !== "";
  const commits = values.get("--commits");
  const commitsFile = commits ? resolve(cwd, commits) : undefined;
  const request = {
    explicit: values.get("--version"),
    bump: values.get("--bump"),
    rc: switches.has("--rc"),
    commits: commitsFile,
    from: values.get("--from"),
  };

  // 1. Everything that can be refused before a file is written.
  const target = targetVersion({
    ...request,
    level: commitsFile ? levelOf(readChanges(commitsFile)) : undefined,
  });
  const tag = `${id}-v${target}`;
  const repo = mustGit(uplinkDir, ["rev-parse", "--show-toplevel"]);
  const dirty = mustGit(repo, ["status", "--porcelain"]);
  if (dirty) {
    throw new Error(
      `the working tree is not clean, so the stamp would mix the release with other changes:\n${dirty}`,
    );
  }
  if (git(repo, ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]).ok) {
    throw new Error(`the tag ${tag} already exists here`);
  }
  if (git(repo, ["remote", "get-url", "origin"]).ok) {
    const remote = git(repo, [
      "ls-remote",
      "--tags",
      "origin",
      `refs/tags/${tag}`,
    ]);
    if (!remote.ok) {
      throw new Error(
        `could not ask origin whether ${tag} exists, so it cannot be shown unspent:\n${remote.out}`,
      );
    }
    if (remote.out) throw new Error(`the tag ${tag} already exists on origin`);
  }

  // 2. The move, then 3 and 4, with every file put back on a failure.
  const scratch = mkdtempSync(join(tmpdir(), "uplink-release-"));
  let moved: string[] = [];
  try {
    const result = moveVersion(uplinkDir, request, deps);
    moved = result.files;
    console.log(`${id}: ${result.from} -> ${result.to}`);

    // The commands find the Uplink from where they run, as they do for an author.
    /*
     * `check` compares the baked hash with the client as it builds now, and the
     * move above has just changed the client, so the bake it would read is the
     * previous version's. Bundling and baking first gives it this one's.
     */
    const bakesAClient = Boolean(
      str(read(join(uplinkDir, "uplink.json")), "gamedata") && hasClientUrl,
    );
    const checkBundle = join(scratch, "check-bundle");
    const steps: [string, () => Promise<boolean>][] = [
      [
        "codegen --check",
        async () => (await run(["codegen", "--check"])) === 0,
      ],
      ...(bakesAClient
        ? ([
            [
              "bundle the client for the check",
              async () => (await run(["bundle", "--out", checkBundle])) === 0,
            ],
            [
              "bake it for the check",
              async () =>
                (await run([
                  "bake",
                  "--bundle",
                  join(checkBundle, id, `${id}.client.js`),
                ])) === 0,
            ],
          ] as [string, () => Promise<boolean>][])
        : []),
      ["check", async () => (await run(["check"])) === 0],
      [
        "the client's tests",
        async () => (deps.runTests ?? clientTests)(clientDir),
      ],
      ["docs --check", async () => (await run(["docs", "--check"])) === 0],
      [
        "release into a scratch folder",
        async () => (await run(["release", "--out", scratch])) === 0,
      ],
    ];
    for (const [label, step] of steps) {
      console.log(`\n== ${label}`);
      if (!(await step())) {
        throw new Error(
          `${label} failed, so ${tag} was not made. Every file is back as it was.`,
        );
      }
    }
  } catch (err) {
    revert(repo, uplinkDir, moved);
    throw err;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  console.log(`\n${id} ${target}: stamped and checked, not committed`);
  return { id, version: target, tag };
}
