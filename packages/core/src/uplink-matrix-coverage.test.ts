import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `scripts/uplink-matrix.mjs` decides which Uplinks every Uplink walker sees.
 * This holds it to the tree from outside.
 *
 * The failure being guarded is not "the script crashes", it is "the script
 * quietly stops seeing an Uplink". Every walker then skips it, and a walk over
 * one fewer Uplink looks exactly like a walk that passed. Every list this
 * repo has lost track of failed that way: the `mod` job's test-project array
 * (four suites, four weeks, 35 tests gated by nothing), the old codegen PATHS
 * array, the isolation ratchet's `client/src`-only walk, ci.yml's `required=()`
 * DLL subset, and `publish-mods.yml`'s matrix, which still names four of eleven.
 *
 * ## Measured against DIFFERENT sources, deliberately
 *
 * The script discovers by walking `mod/`. A test that also walked `mod/` would
 * ask the same question of the same source and would agree with a broken walk,
 * which is worth nothing. So the client half is checked against
 * `pnpm-lock.yaml`'s `importers` (written by pnpm, not by us) and the mod half
 * against `mod/Gonogo.sln` (maintained by `dotnet sln`).
 *
 * That is the same argument `uplink-mod-build-coverage.test.ts` makes for
 * reading the solution, and the reason both live in `packages/core`: it is where
 * this repo keeps cross-package structural ratchets, and the `test` job that
 * runs them is blocking. A guard for a gating list must not be able to land
 * behind an exemption.
 */

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = "scripts/uplink-matrix.mjs";

type Leg = {
  id: string;
  pkg: string;
  client: boolean;
  csproj: boolean;
  tests: boolean;
  contract: boolean;
  generated: boolean;
};

/**
 * Run the discovery, keeping a non-zero exit as DATA rather than letting it
 * throw at module scope. Thrown here it becomes a vitest collection error
 * reporting "no tests", which is a failure whose message says nothing about the
 * matrix; the first test below can then explain what actually happened.
 */
function runMatrix(): { legs: Leg[]; failure: string | null } {
  try {
    return {
      legs: JSON.parse(
        execFileSync("node", [join(ROOT, SCRIPT)], { encoding: "utf8" }),
      ),
      failure: null,
    };
  } catch (error) {
    const stderr: unknown =
      typeof error === "object" && error !== null
        ? Reflect.get(error, "stderr")
        : undefined;
    const message = error instanceof Error ? error.message : undefined;
    return { legs: [], failure: String(stderr ?? message ?? error) };
  }
}

const { legs: matrix, failure: matrixFailure } = runMatrix();

/** Uplink clients as pnpm's own lockfile records them. */
function lockfileClients(): string[] {
  const lock = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
  const ids = new Set<string>();
  for (const match of lock.matchAll(
    /^ {2}mod\/(Gonogo[A-Za-z0-9]*Uplink)\/client:/gm,
  )) {
    ids.add(match[1]);
  }
  return [...ids].sort();
}

/**
 * Uplink client manifests as git tracks them: a third source, so the lockfile
 * read is not compared against the walk alone.
 */
function trackedClients(): string[] {
  const ids = new Set<string>();
  for (const rel of execFileSync(
    "git",
    ["ls-files", "mod/*/client/package.json"],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  ).split("\n")) {
    const match =
      /^mod\/(Gonogo[A-Za-z0-9]*Uplink)\/client\/package\.json$/.exec(rel);
    if (match) ids.add(match[1]);
  }
  return [...ids].sort();
}

/** Uplink plugin projects as a `Gonogo.sln` lists them, the repo's own by default. */
function solutionUplinks(slnPath = "mod/Gonogo.sln"): string[] {
  const sln = readFileSync(join(ROOT, slnPath), "utf8");
  const ids = new Set<string>();
  for (const match of sln.matchAll(
    /^Project\("\{[^}]+}"\)\s*=\s*"([^"]+)"/gm,
  )) {
    if (/^Gonogo.*Uplink$/.test(match[1])) ids.add(match[1]);
  }
  return [...ids].sort();
}

describe("the Uplink discovery covers every Uplink", () => {
  it("the discovery runs at all", () => {
    expect(
      matrixFailure,
      `${SCRIPT} exited non-zero, so every Uplink walker has nothing to walk and every check below is ` +
        `comparing against an empty list. Its own output:\n${matrixFailure}`,
    ).toBeNull();
  });

  it("sees every client pnpm knows about", () => {
    const fromLock = lockfileClients();
    // Guards the guard: a lockfile read that matched nothing would compare two empty sets and pass, so the lockfile is held to git's own list of client manifests, which a broken read cannot match at any count.
    expect(
      fromLock,
      "pnpm-lock.yaml's mod/Gonogo*Uplink/client importers disagree with the client manifests git " +
        "tracks. Either the lockfile read stopped matching (its format or the workspace layout " +
        "changed) or the lockfile is out of date with the tree.",
    ).toEqual(trackedClients());

    expect(
      matrix.filter((leg) => leg.client).map((leg) => leg.id),
      `${SCRIPT} disagrees with pnpm about which Uplinks have a client. An Uplink missing here ` +
        `is skipped by every walker, and a walk over one fewer Uplink reports exactly like one that passed.`,
    ).toEqual(fromLock);
  });

  it("sees every plugin project in the solution", () => {
    const fromSolution = solutionUplinks();
    /*
     * Guards the solution read without a floor on how many Uplinks remain: over
     * the planted fixture's solution it must find exactly the planted project,
     * and the real solution must be the one that builds this repo.
     */
    expect(
      solutionUplinks("mod/Sitrep.Core.Tests/UplinkWalkPlant/Gonogo.sln"),
      "The solution read over the planted fixture did not find exactly the planted Uplink, so " +
        "it can compare nothing to nothing.",
    ).toEqual(["GonogoPlantedUplink"]);
    expect(
      readFileSync(join(ROOT, "mod/Gonogo.sln"), "utf8"),
      "mod/Gonogo.sln does not declare Sitrep.Core.Tests, so it is not the solution this repo builds.",
    ).toMatch(/=\s*"Sitrep\.Core\.Tests"/);
    expect(
      matrix.filter((leg) => leg.csproj).map((leg) => leg.id),
      `${SCRIPT} disagrees with mod/Gonogo.sln about which Uplinks have a plugin csproj.`,
    ).toEqual(fromSolution);
  });

  it("every Uplink has a client or a plugin csproj", () => {
    const idle = matrix.filter((leg) => !leg.client && !leg.csproj);
    expect(
      idle.map((leg) => leg.id),
      "An Uplink directory has neither a client nor a plugin csproj, so every walker would " +
        "check nothing in it and report green.",
    ).toEqual([]);
  });

  it("every Uplink claiming a capability has it on disk", () => {
    for (const leg of matrix) {
      const base = join(ROOT, "mod", leg.id);
      expect(
        existsSync(join(base, "client", "package.json")),
        `${leg.id}.client`,
      ).toBe(leg.client);
      expect(
        existsSync(join(base, `${leg.id}.csproj`)),
        `${leg.id}.csproj`,
      ).toBe(leg.csproj);
      expect(
        existsSync(join(ROOT, "mod", `${leg.id}.Tests`)),
        `${leg.id}.tests`,
      ).toBe(leg.tests);
      expect(
        existsSync(join(ROOT, "mod", `${leg.id}.Contract`)),
        `${leg.id}.contract`,
      ).toBe(leg.contract);
      if (leg.client) {
        expect(leg.pkg, `${leg.id} has a client but no package name`).not.toBe(
          "",
        );
      }
    }
  });

  it("the script proves its discovery on the planted fixture", () => {
    // The script refuses to emit a matrix when its walk over the plant is wrong,
    // which "the discovery runs at all" reports. This pins that the plant it
    // names is the one the C# walks are proved on, so neither can be deleted
    // without the other noticing.
    expect(readFileSync(join(ROOT, SCRIPT), "utf8")).toContain(
      'join(MOD, "Sitrep.Core.Tests", "UplinkWalkPlant")',
    );
    expect(
      existsSync(
        join(
          ROOT,
          "mod/Sitrep.Core.Tests/UplinkWalkPlant/GonogoPlantedUplink/GonogoPlantedUplink.csproj",
        ),
      ),
    ).toBe(true);
  });

  it("gives no leg to an untracked directory that only looks like an Uplink", () => {
    /**
     * A departed Uplink leaves `obj/` and `dist/` behind and takes every
     * tracked file with it, so the directory name outlives the Uplink. Four
     * phantom legs once lived in that gap, and the disagreement ran the wrong
     * way: red locally, green on a clean CI checkout where the leftovers do not
     * exist.
     *
     * Planted inside the walk fixture rather than in `mod/`, for two reasons.
     * Nothing else walks that directory, so a crash between plant and cleanup
     * cannot reach another gate. And the script already asserts EXACTLY ONE leg
     * over the fixture, so a discovery that counted the phantom refuses to emit
     * a matrix at all: the assertion is the script's own exit status, not a
     * second opinion written here.
     */
    const phantom = join(
      ROOT,
      "mod/Sitrep.Core.Tests/UplinkWalkPlant/GonogoPhantomUplink",
    );
    mkdirSync(join(phantom, "obj"), { recursive: true });
    writeFileSync(join(phantom, "obj", "leftover.txt"), "stale build output\n");
    try {
      // The control: the phantom is on disk and its name is one the filter
      // matches, so the only thing that can exclude it is the tracked check. A
      // fixture that failed to plant would pass this test having proved nothing.
      expect(existsSync(phantom)).toBe(true);
      expect(/^Gonogo.*Uplink$/.test("GonogoPhantomUplink")).toBe(true);
      expect(
        execFileSync("git", ["ls-files", "--", phantom], {
          cwd: ROOT,
          encoding: "utf8",
        }),
      ).toBe("");

      const { legs, failure } = runMatrix();
      expect(
        failure,
        `The discovery counted an untracked directory, so its walk over the ` +
          `planted fixture found more than the one leg it expects and it ` +
          `refused to emit a matrix:\n${failure}`,
      ).toBeNull();
      expect(legs.map((leg) => leg.id)).not.toContain("GonogoPhantomUplink");
    } finally {
      rmSync(phantom, { recursive: true, force: true });
    }
  });
});
