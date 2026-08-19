import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATED_CONTROL_CHANNELS } from "./__generated__/control-channels";
import { TOPIC_IDS } from "./topics";

// mod/sitrep-sdk/src -> mod
const MOD_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Recursively collect production C# sources (skip build output, tests, skeleton). */
function collectContractSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (
        entry === "obj" ||
        entry === "bin" ||
        entry === "node_modules" ||
        // Build output, and 43% of everything under mod/ once the spine landed
        // in the sdk. It cannot contain a `.cs` file, so walking it is pure cost:
        // enough of it to push this test's 5s budget over on a parallel run.
        entry === "dist" ||
        entry.includes("Tests") ||
        entry === "Sitrep.Skeleton"
      ) {
        continue;
      }
      collectContractSources(full, out);
    } else if (entry.endsWith(".cs")) {
      out.push(full);
    }
  }
  return out;
}

/** Every `const string <Name>Command = "<value>"` declared in the mod sources. */
function extractDeclaredCommands(): Set<string> {
  const re = /const\s+string\s+\w*Command\w*\s*=\s*"([^"]+)"/g;
  const commands = new Set<string>();
  for (const file of collectContractSources(MOD_ROOT)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(re)) commands.add(m[1]);
  }
  return commands;
}

describe("control channel to C# sync", () => {
  /**
   * The 30s budget is not slack for the assertion, which is a set lookup over a
   * few dozen strings. It is for `extractDeclaredCommands`, which walks and reads
   * every production `.cs` file under `mod/`.
   *
   * That walk costs ~120ms run alone and has been measured at 5854ms inside a
   * full parallel `pnpm test`, a ~48x swing that comes from I/O contention with
   * the other packages' suites rather than from anything this test does. Under the
   * default 5s it therefore failed as a timeout on the whole-repo run while
   * passing in isolation, which reads as a contract break and is not one. The
   * previous narrowing of the walk (skipping `dist`) bought headroom and did not
   * change the shape of the problem: a wall-clock budget cannot bound a
   * filesystem walk whose duration depends on what else is running.
   */
  it("every channel write command is declared as a C# command const", () => {
    const declared = extractDeclaredCommands();
    const missing = GENERATED_CONTROL_CHANNELS.map(
      (c) => c.writeCommand,
    ).filter((cmd) => !declared.has(cmd));
    expect(
      missing,
      "channel write commands with no C# `const string ...Command`",
    ).toEqual([]);
  }, 30_000);

  it("every channel read topic is a known TopicId", () => {
    const topics = new Set<string>(TOPIC_IDS);
    const missing = GENERATED_CONTROL_CHANNELS.map((c) => c.readTopic).filter(
      (t) => !topics.has(t),
    );
    expect(missing, "channel read topics not in TOPIC_IDS").toEqual([]);
  });
});
