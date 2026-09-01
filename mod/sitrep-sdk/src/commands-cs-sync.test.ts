import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMAND_IDS } from "./commands";

// mod/sitrep-sdk/src -> mod
const MOD_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * A command declared in C# and never tagged `[SitrepCommand]` is invisible to
 * the generated map, and invisible is exactly the state this whole registry
 * exists to end: it reads as "that command does not exist" to an author, with
 * nothing failing anywhere. So the map is judged against a SECOND instrument
 * that does not share its mechanism, a textual scan of the C# declarations,
 * rather than against itself.
 *
 * The scan is deliberately narrow and the narrowing is load-bearing. Requiring
 * the const's name to END with `Command` rather than merely contain one drops
 * `CommandCentreTopic`, which is a Topic and matched the looser form; that one
 * false positive was 1 of 109 and would have failed this test forever on a
 * command that does not exist.
 */
function collectModSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (
        entry === "obj" ||
        entry === "bin" ||
        entry === "node_modules" ||
        // Build output, and the bulk of everything under mod/. It cannot hold a
        // `.cs` file, so walking it is pure cost: see control-channels-cs-sync's
        // note on what that costs under a parallel run.
        entry === "dist" ||
        entry.includes("Tests") ||
        entry === "Sitrep.Skeleton"
      ) {
        continue;
      }
      collectModSources(full, out);
    } else if (entry.endsWith(".cs")) {
      out.push(full);
    }
  }
  return out;
}

/** Every `const string <Name>Command = "<value>"` declared in the mod sources. */
function declaredCommands(): Set<string> {
  const re = /const\s+string\s+\w*Command\s*=\s*"([^"]+)"/g;
  const commands = new Set<string>();
  for (const file of collectModSources(MOD_ROOT)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(re)) commands.add(m[1]);
  }
  return commands;
}

/**
 * An id in the generated map whose args type lives in an Uplink's own contract
 * slice, and so is NOT in this SDK's `COMMAND_IDS`. Read off each slice's own
 * generated map by the same parse the docs generator uses, so the two agree
 * about what an Uplink declares.
 */
function uplinkCommands(): Set<string> {
  const ids = new Set<string>();
  for (const entry of readdirSync(MOD_ROOT)) {
    const mapPath = join(
      MOD_ROOT,
      entry,
      "client",
      "src",
      "__generated__",
      "command-map.ts",
    );
    let src: string;
    try {
      src = readFileSync(mapPath, "utf8");
    } catch {
      continue;
    }
    for (const line of src.split(/\r?\n/)) {
      const m = /^ {2}"([^"]+)": \w/.exec(line);
      if (m) ids.add(m[1]);
    }
  }
  return ids;
}

describe("command map to C# sync", () => {
  /**
   * The 30s budget is not slack for the assertion. It is for the walk, which
   * reads every production `.cs` file under `mod/` and has been measured 48x
   * slower inside a full parallel `pnpm test` than run alone. See
   * `control-channels-cs-sync.test.ts` for the measurement.
   */
  it("every mapped command is declared as a C# command const", () => {
    const declared = declaredCommands();
    const mapped = [...COMMAND_IDS, ...uplinkCommands()];
    expect(
      mapped.filter((id) => !declared.has(id)),
      "mapped commands with no C# `const string ...Command`",
    ).toEqual([]);
  }, 30_000);

  /**
   * The direction that catches the failure this registry was built for. The
   * other way round only catches a stale map entry; THIS one catches a command
   * that exists, dispatches, and cannot be found.
   */
  it("every C# command const appears in a generated command map", () => {
    const mapped = new Set<string>([...COMMAND_IDS, ...uplinkCommands()]);
    expect(
      [...declaredCommands()].filter((id) => !mapped.has(id)).sort(),
      "commands the C# declares that no generated map names. Tag the args " +
        'class with [SitrepCommand("<id>")] and re-run mod/codegen.sh',
    ).toEqual([]);
  }, 30_000);

  /** The scan finding nothing reports a clean pass, so the floor is asserted. */
  it("the C# scan finds the commands it is scanning for", () => {
    expect(declaredCommands().size).toBeGreaterThan(90);
  }, 30_000);
});
