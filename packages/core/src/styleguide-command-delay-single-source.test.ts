import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerUplinkCommand } from "@ksp-gonogo/sitrep-sdk";
import { commandDelayed } from "@ksp-gonogo/sitrep-sdk/spine";
import { describe, expect, it } from "vitest";

/**
 * Whether a command rides signal delay is declared ONCE, and both halves read
 * that one declaration.
 *
 * The defect this replaced: the mod stated it per command on
 * `CommandDeclaration.Delayed`, the client kept a hand-written set of instant
 * ids in `map-command.ts`, and nothing carried either answer to the other. The
 * mod ran 54 commands the instant they arrived; the client's set named two. So
 * 52 commands were drawn with a countdown and an in-flight queue row that was a
 * fiction about the operator's own order, and neither side could see it.
 *
 * The declaration now lives on each command's `[SitrepCommand(Delayed = ...)]`
 * in the contract. The host dispatches by it (`ChannelEngine.ResolveCommandDelay`
 * through `CommandDelayCatalog`), and the SDK codegen writes it into
 * `GENERATED_COMMAND_RAIL`, which is where `commandDelayed` reads it. This file
 * holds the two halves of that claim that a type cannot:
 *
 * 1. every command any generated map declares gets the map's own answer out of
 *    `commandDelayed`, for the SDK's commands and an Uplink's alike
 * 2. no shipped manifest restates the answer, so there is nothing left to drift
 *
 * `codegen-check.sh` is the third leg and already exists: it re-runs the codegen
 * and fails on a diff, so a map here cannot be stale with respect to the
 * attribute the host reads.
 */

const SCAN_ROOTS = ["mod"];

/**
 * A delay disposition written on a `CommandDeclaration`, in either spelling: the
 * property, and the `delayed:` argument a private factory used to take.
 *
 * `Delayed` as a plain bool is unambiguous in this tree. A channel says
 * `Delay = DelayRole.Delayed`, which is an assignment of an ENUM MEMBER to a
 * differently-named property, and several files have a `Delayed(topic)` channel
 * factory, which is a call. Neither matches.
 */
const RESTATED_RE =
  /\bDelayed\s*=\s*(?:true|false)\b|\bdelayed:\s*(?:true|false)\b/;

/** `[SitrepCommand("x", Delayed = false)]`: the one declaration, not a restatement. */
const ATTRIBUTE_RE = /\[SitrepCommand\([^\]]*\)\]/g;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_RE = /\/\/.*$/gm;

/**
 * What the probe is entitled to read: executable C#, with the comments and the
 * contract attribute taken out.
 *
 * Both removals are load-bearing and neither is a loophole. The ATTRIBUTE is
 * where the value is supposed to be, so matching it would make the single source
 * of truth its own violation. COMMENTS are where this tree records what a rule
 * used to be, at length and on purpose, and a gate that made the old spelling
 * unquotable would delete the history explaining why it changed.
 */
function executable(source: string): string {
  return source
    .replace(BLOCK_COMMENT_RE, " ")
    .replace(LINE_COMMENT_RE, " ")
    .replace(ATTRIBUTE_RE, " ");
}

/**
 * Where a restatement is still legitimate: a test declaring an ad-hoc command id
 * nothing tags, which is the one case `CommandDeclaration.Delayed` survives for.
 * A shipped Uplink has no such id.
 */
const isTestSource = (rel: string): boolean =>
  /(?:^|\/)[^/]*Tests?\//.test(rel) || /Test[A-Za-z]*\.cs$/.test(rel);

/**
 * The walk must see at least this many C# sources to be believed. An
 * enumeration that returns nothing finds no restatements, and no restatements is
 * exactly what success looks like here.
 */
const CSHARP_FLOOR = 400;

/** Likewise: fewer maps than this and the agreement half proved nothing. */
const MAP_FLOOR = 6;

/** And fewer commands than this. Core alone declares over fifty. */
const COMMAND_FLOOR = 80;

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

function tracked(pattern: RegExp): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", ...SCAN_ROOTS], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((rel) => pattern.test(rel));
}

interface Row {
  readonly map: string;
  readonly id: string;
  readonly delayed: boolean;
}

/**
 * Every row of every generated command rail in the repo: the SDK's own, and one
 * map per Uplink that owns commands.
 *
 * Parsed out of the emitted TypeScript rather than imported, so an Uplink's map
 * is read the same way whether or not this package could import that Uplink at
 * all (it cannot: they are private to their own client packages).
 */
function railRows(): Row[] {
  const rows: Row[] = [];
  for (const rel of tracked(/__generated__\/command-map\.ts$/)) {
    const source = readFileSync(join(ROOT, rel), "utf8");
    const table =
      /export const GENERATED_COMMAND_RAIL = \{([\s\S]*?)\n\} as const/.exec(
        source,
      );
    expect(table, `${rel} carries no GENERATED_COMMAND_RAIL`).not.toBeNull();
    for (const row of (table as RegExpExecArray)[1].matchAll(
      /"([^"]+)":\s*\{([^}]*)\}/g,
    )) {
      const delayed = /\bdelayed:\s*(true|false)\b/.exec(row[2]);
      expect(
        delayed,
        `${rel}'s ${row[1]} row carries no delayed column. A missing column ` +
          "reads as delayed for every command, which is the countdown this " +
          "arrangement exists to stop drawing.",
      ).not.toBeNull();
      rows.push({
        map: rel,
        id: row[1],
        delayed: (delayed as RegExpExecArray)[1] === "true",
      });
    }
  }
  return rows;
}

describe("the delay disposition is declared once", () => {
  it("answers every declared command with that command's own generated row", () => {
    const rows = railRows();
    const maps = new Set(rows.map((row) => row.map));
    expect(maps.size).toBeGreaterThanOrEqual(MAP_FLOOR);
    expect(rows.length).toBeGreaterThanOrEqual(COMMAND_FLOOR);

    /*
     * An Uplink's commands reach the SDK the way its client package delivers
     * them at load, through `registerUplinkCommand` off its own generated map.
     * Registering them here is that same path, so an Uplink command is under
     * test on the same terms as a core one.
     */
    for (const row of rows) {
      if (row.map.startsWith("mod/sitrep-sdk/")) continue;
      registerUplinkCommand(row.id, { replies: true, delayed: row.delayed });
    }

    const disagreed = rows.filter(
      (row) => commandDelayed(row.id) !== row.delayed,
    );
    expect(
      disagreed.map((row) => `${row.id} (${row.map})`),
      "commandDelayed must return the command's own declared disposition",
    ).toEqual([]);
  });

  it("draws no countdown over a command the mod runs on arrival", () => {
    const instant = railRows().filter((row) => !row.delayed);
    // A tree where nothing is instant would pass the agreement check above
    // while proving only that `true` equals `true`.
    expect(instant.length).toBeGreaterThan(0);
    for (const row of instant) expect(commandDelayed(row.id)).toBe(false);
  });

  it("has no shipped manifest restating it", () => {
    const sources = tracked(/\.cs$/);
    expect(sources.length).toBeGreaterThanOrEqual(CSHARP_FLOOR);

    // The probe can see a restatement. Asserted against a planted string
    // because a regex that stopped matching would report a clean tree.
    expect(RESTATED_RE.test("new CommandDeclaration { Delayed = false }")).toBe(
      true,
    );
    expect(RESTATED_RE.test("Command(TargetSetCommand, delayed: false)")).toBe(
      true,
    );
    expect(RESTATED_RE.test("Delay = DelayRole.Delayed,")).toBe(false);
    expect(
      RESTATED_RE.test(
        executable('[SitrepCommand("ksp.launch", Delayed = false)]'),
      ),
    ).toBe(false);
    expect(
      RESTATED_RE.test(executable("// was Delayed = false before the ruling")),
    ).toBe(false);

    const offenders = sources
      .filter((rel) => !isTestSource(rel))
      .filter((rel) =>
        RESTATED_RE.test(executable(readFileSync(join(ROOT, rel), "utf8"))),
      );
    expect(
      offenders,
      "a shipped manifest stating a delay disposition is the second source of " +
        "truth this arrangement removed. Put the value on the command's " +
        "[SitrepCommand] instead, where the client reads it too.",
    ).toEqual([]);
  });
});
