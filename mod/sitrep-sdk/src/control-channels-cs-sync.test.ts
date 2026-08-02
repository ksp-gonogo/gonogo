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
  it("every channel write command is declared as a C# command const", () => {
    const declared = extractDeclaredCommands();
    const missing = GENERATED_CONTROL_CHANNELS.map(
      (c) => c.writeCommand,
    ).filter((cmd) => !declared.has(cmd));
    expect(
      missing,
      "channel write commands with no C# `const string ...Command`",
    ).toEqual([]);
  });

  it("every channel read topic is a known TopicId", () => {
    const topics = new Set<string>(TOPIC_IDS);
    const missing = GENERATED_CONTROL_CHANNELS.map((c) => c.readTopic).filter(
      (t) => !topics.has(t),
    );
    expect(missing, "channel read topics not in TOPIC_IDS").toEqual([]);
  });
});
