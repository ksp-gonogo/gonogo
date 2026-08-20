import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every test project in `mod/Gonogo.sln` must be named in `ci.yml`'s
 * `projects=(...)` array, and every name in that array must be a project that
 * exists.
 *
 * That array is hand-maintained by construction and cannot stop being: the
 * solution cannot be tested wholesale while the KSP-linked projects reference a
 * gitignored KSP install, which is sound and documented in `ci.yml`'s own
 * SCOPING note. The problem is that **nothing noticed when the two drifted**,
 * and the result was not a warning but a suite that silently never ran. Four
 * projects accumulated that way over four weeks (`GonogoAvionicsUplink.Tests`
 * and `GonogoTestFlightUplink.Tests` from 2026-07-22, `GonogoMechJebUplink.Tests`
 * from 2026-08-08, `GonogoPrincipiaUplink.Tests` found the day it landed): 35
 * tests gated by nothing, costing 343ms to run.
 *
 * Both directions are checked, because they fail differently and both fail
 * silently:
 *
 * - a project in the solution and not in the array never runs in CI
 * - a name in the array for a project that no longer exists is a `dotnet test`
 *   against a missing csproj, which after this repo's four retries fails the
 *   whole `mod` job for a reason that looks nothing like a deleted project
 *
 * Lives in `@ksp-gonogo/core` because that is where this repo keeps
 * cross-package structural ratchets (see `uplink-boundary.test.ts` and
 * `uplink-isolation.test.ts`), and because the `test` job that runs it is
 * blocking, unlike the `mod` job's own non-blocking WS suite. A guard for the
 * gating list must not be able to land behind an exemption.
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

/** Project names in the solution whose name marks them a test project. */
function solutionTestProjects(): string[] {
  const sln = readFileSync(join(ROOT, "mod/Gonogo.sln"), "utf8");
  const names = new Set<string>();
  // Solution project lines: Project("{guid}") = "Name", "Name\Name.csproj", ...
  for (const match of sln.matchAll(
    /^Project\("\{[^}]+}"\)\s*=\s*"([^"]+)"/gm,
  )) {
    const name = match[1];
    if (name.endsWith(".Tests") || name.endsWith("IntegrationTests")) {
      names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * The names inside `ci.yml`'s `projects=( ... )` array, in the `mod` job.
 *
 * Parsed rather than imported because the array is shell inside YAML, so there
 * is nothing to import. Anchored on `projects=(` through the closing `)` so a
 * comment mentioning a project name cannot be mistaken for an entry, which
 * matters here: the array is now surrounded by a comment that names all four of
 * the projects that were missing from it.
 */
function ciGatedProjects(): string[] {
  const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const block = ci.match(/^\s*projects=\(\s*$([\s\S]*?)^\s*\)\s*$/m);
  if (!block) {
    throw new Error(
      "could not find ci.yml's `projects=(` array: this guard is parsing by " +
        "shape, so a rename or reformat needs it updated rather than deleted",
    );
  }
  return block[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .sort();
}

describe("ci.yml's mod-job project list covers the solution's test projects", () => {
  it("finds both lists at all, before comparing them", () => {
    // A parse that silently returned nothing would make every assertion below
    // pass while checking nothing, which is the exact failure shape this file
    // exists to prevent.
    expect(solutionTestProjects().length).toBeGreaterThan(10);
    expect(ciGatedProjects().length).toBeGreaterThan(10);
  });

  it("runs every test project that is in the solution", () => {
    const missing = solutionTestProjects().filter(
      (p) => !ciGatedProjects().includes(p),
    );
    expect(
      missing,
      `these test projects are in mod/Gonogo.sln but in no CI job, so their tests ` +
        `never run: add them to ci.yml's projects=() array (and NOT to ` +
        `nonblocking unless they carry the WS harness)`,
    ).toEqual([]);
  });

  it("names no project that does not exist", () => {
    const gated = ciGatedProjects();
    const inSolution = solutionTestProjects();
    const dead = gated.filter(
      (p) =>
        !inSolution.includes(p) ||
        !existsSync(join(ROOT, "mod", p, `${p}.csproj`)),
    );
    expect(
      dead,
      `ci.yml names these projects but they are not in mod/Gonogo.sln with a ` +
        `matching csproj on disk, so the mod job will fail on a missing project ` +
        `for a reason that looks nothing like a deleted one`,
    ).toEqual([]);
  });
});
