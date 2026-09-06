import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `scripts/uplink-mod-build.sh` compiles every Uplink plugin assembly. This
 * holds the script to the tree from the outside.
 *
 * The hole it closes: no `Gonogo*Uplink.Tests` project references its own
 * Uplink's implementation csproj, so `dotnet test` going green has never meant
 * those eleven assemblies compile. Seven appeared in no workflow at all; the
 * other four only in `publish-mods.yml`, which runs after CI on main.
 *
 * Three things are checked here rather than in the script, because the script
 * needs the private `ksp-managed` checkout to run at all and these do not:
 *
 * 1. **CI actually invokes it.** A gate nobody calls reports nothing and looks
 *    exactly like a gate that found nothing
 * 2. **Every exemption names a project that exists.** The script checks the
 *    other direction (an exemption whose blocking DLL has been vendored is
 *    stale and fails there, since only it can see the reference set)
 * 3. **The discovery reaches every Uplink**, measured against a DIFFERENT
 *    source of truth than the one the script uses
 *
 * Point 3 is the one worth the effort. The script discovers with `find`, so a
 * test that also globs the filesystem asks the same question of the same
 * source and would agree with a broken pattern. `mod/Gonogo.sln` is
 * independent: it is maintained by `dotnet sln`, and an Uplink that exists but
 * does not match the script's pattern shows up here as a solution member with
 * no matching discovery. `ci-test-project-coverage.test.ts` reads the solution
 * for the same reason.
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
const SCRIPT_PATH = "scripts/uplink-mod-build.sh";
const script = readFileSync(join(ROOT, SCRIPT_PATH), "utf8");

/** Uplink plugin projects as `mod/Gonogo.sln` lists them, tests and contract slices excluded. */
function solutionUplinkProjects(): string[] {
  const sln = readFileSync(join(ROOT, "mod/Gonogo.sln"), "utf8");
  const names = new Set<string>();
  for (const match of sln.matchAll(
    /^Project\("\{[^}]+}"\)\s*=\s*"([^"]+)"/gm,
  )) {
    const name = match[1];
    if (/^Gonogo.*Uplink$/.test(name)) names.add(name);
  }
  return [...names].sort();
}

/** Uplink plugin projects the script's `find` expression would reach. */
function discoveredUplinkProjects(): string[] {
  const modDir = join(ROOT, "mod");
  return readdirSync(modDir)
    .filter((entry) => /^Gonogo.*Uplink$/.test(entry))
    .filter((entry) => existsSync(join(modDir, entry, `${entry}.csproj`)))
    .sort();
}

/** `"<name>|<dll>|<reason>"` entries from the script's EXEMPT array. */
function exemptions(): { name: string; dll: string; reason: string }[] {
  const block = script.match(/^EXEMPT=\(\n([\s\S]*?)^\)$/m);
  if (!block)
    throw new Error(`No EXEMPT=( ... ) array found in ${SCRIPT_PATH}`);
  return [...block[1].matchAll(/^\s*"([^|]+)\|([^|]+)\|([\s\S]*?)"\s*$/gm)].map(
    (m) => ({ name: m[1], dll: m[2], reason: m[3] }),
  );
}

describe("every Uplink plugin assembly is compiled by CI", () => {
  it("the mod job invokes the build script", () => {
    const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(
      ci.includes(SCRIPT_PATH),
      `${SCRIPT_PATH} is not referenced by .github/workflows/ci.yml, so nothing compiles the ` +
        `Uplink plugin assemblies. That is the state this script was written to end, and a ` +
        `script CI never calls reports the same nothing as a script that found no problems.`,
    ).toBe(true);
  });

  it("the script's discovery reaches every Uplink in the solution", () => {
    const inSolution = solutionUplinkProjects();
    const discovered = discoveredUplinkProjects();

    // Guards the guard: a solution read that matched nothing would make the
    // comparison below pass against an empty set. 6 since GonogoTestFlightUplink
    // and four more left for the gonogo-uplinks repo.
    expect(
      inSolution.length,
      "mod/Gonogo.sln lists no Gonogo*Uplink projects, so this test is comparing two empty sets.",
    ).toBeGreaterThanOrEqual(6);

    expect(
      discovered,
      `An Uplink in mod/Gonogo.sln is not reachable by ${SCRIPT_PATH}'s discovery, so its plugin ` +
        `assembly is compiled by nothing. Either the directory does not match mod/<Name>/<Name>.csproj ` +
        `or the project was removed from disk without leaving the solution.`,
    ).toEqual(inSolution);
  });

  it("every exemption names an Uplink that exists", () => {
    const discovered = new Set(discoveredUplinkProjects());
    for (const { name } of exemptions()) {
      expect(
        discovered.has(name),
        `${SCRIPT_PATH} exempts "${name}" from compiling, but no such Uplink csproj exists. ` +
          `An exemption for a project that is gone reads as coverage of something and covers nothing.`,
      ).toBe(true);
    }
  });

  it("every exemption carries a reason and a blocking DLL", () => {
    const found = exemptions();
    // The parse itself is the assertion: an entry that lost its reason or its
    // DLL does not match, so a silently-shrinking list would show up here as a
    // count that disagrees with the raw line count.
    const rawEntries = (script.match(/^EXEMPT=\(\n([\s\S]*?)^\)$/m)?.[1] ?? "")
      .split("\n")
      .filter((line) => line.trim().startsWith('"')).length;
    expect(
      found.length,
      `An EXEMPT entry in ${SCRIPT_PATH} is not in "<name>|<dll>|<reason>" form. The reason and ` +
        `the DLL are what let the exemption expire by itself; a bare name outlives its cause, ` +
        `which is exactly what Sitrep.Host.IntegrationTests did for over a month.`,
    ).toBe(rawEntries);
    for (const { name, dll, reason } of found) {
      expect(
        dll.trim().length,
        `${name}'s exemption names no blocking DLL`,
      ).toBeGreaterThan(0);
      expect(
        reason.trim().length,
        `${name}'s exemption gives no reason`,
      ).toBeGreaterThan(20);
    }
  });

  it("the script's discovery floor is not above what the tree holds", () => {
    const floor = Number(script.match(/^FLOOR=(\d+)$/m)?.[1]);
    expect(Number.isFinite(floor), `No FLOOR=<n> found in ${SCRIPT_PATH}`).toBe(
      true,
    );
    expect(
      floor,
      `${SCRIPT_PATH}'s FLOOR (${floor}) exceeds the ${discoveredUplinkProjects().length} Uplinks ` +
        `on disk, so the script fails every run for a reason that has nothing to do with the tree.`,
    ).toBeLessThanOrEqual(discoveredUplinkProjects().length);
  });
});
