import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exitStatus } from "./ratchetBaseRef";

/**
 * Every `useCommand` handle registers with the nearest panel delay rail, which
 * shows each dispatch's refusal, loss and never-sent outcome with its reason,
 * and a dev build throws when a handle dispatches with no rail mounted. So a
 * command's outcome reaches the operator by construction, and the two ways
 * around that are what this scan holds:
 *
 * - `rail: false`, which keeps a handle off the rail. Only a hook or form that
 *   draws the outcome itself may pass it, and each such file is named below
 * - dispatching past `useCommand` altogether, through the telemetry client or
 *   `dispatchActiveCommandTopic`. A widget has no business doing either; the
 *   app's own services (alarms, the peer relay) read those outcomes themselves
 */

/**
 * The files allowed to keep a handle off the rail, each with how many times.
 * A file absent here may not pass `rail: false` at all, and an entry above its
 * file's count fails, so a removed opt-out cannot leave room for a new one.
 */
const RAIL_OPT_OUTS: Record<string, number> = {
  // Draws its stream on its own ControlDelayStream.
  "packages/sitrep-client/src/use-control-stream.tsx": 1,
  // The settings modal mounts no rail; each form states its write's outcome.
  "packages/app/src/settings/GonogoSettings.tsx": 1,
  "packages/app/src/settings/ModSettingsSection.tsx": 1,
};

/** Widget-root files allowed to dispatch past `useCommand`, each with how many times. */
const RAW_DISPATCHERS: Record<string, number> = {
  // A trigger fires with no widget mounted, and reports every outcome through its `onFailure`.
  "packages/components/src/ManeuverPlanner/triggerDispatch.ts": 1,
};

/** Where widget code lives: the built-in library and every Uplink's client. */
const WIDGET_ROOTS = ["packages/components/src", "mod/*/client/src"];

const SEARCH_GLOBS = ["*.ts", "*.tsx"];

/** POSIX ERE via `git grep -E`, which has no `\b` and no `\s`. */
const RAIL_OPT_OUT = "rail[[:space:]]*:[[:space:]]*false";
const RAW_DISPATCH = String.raw`[Cc]lient\.dispatch\(|dispatchActiveCommandTopic\(`;

/** Build output, tests and fixtures own what they do. */
const EXCLUDED = /\/dist\/|\.test\.|\.spec\.|test-d|__fixtures__|__generated__/;

/** A line whose first non-space character opens a comment is prose, not code. */
const COMMENT_LINE = /^(\/\/|\*|\/\*)/;

type GrepPass = (pattern: string, pathspecs: string[]) => string;

function runGrep(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 16,
    });
  } catch (err) {
    if (exitStatus(err) === 1) return "";
    throw err;
  }
}

function repoPass(root: string): GrepPass {
  // `--untracked` so a new file's opt-out is seen before it is committed.
  return (pattern, pathspecs) =>
    runGrep(root, ["grep", "--untracked", "-nE", pattern, "--", ...pathspecs]);
}

/**
 * Occurrences per file, counted in JavaScript over the lines `git grep`
 * returned, with prose lines and excluded paths dropped.
 */
function countsByFile(
  pass: GrepPass,
  pattern: string,
  pathspecs: string[],
): Map<string, number> {
  const counter = new RegExp(pattern.replaceAll("[[:space:]]", "\\s"), "g");
  const counts = new Map<string, number>();
  for (const record of pass(pattern, pathspecs).split("\n")) {
    if (!record || EXCLUDED.test(record)) continue;
    const first = record.indexOf(":");
    const second = record.indexOf(":", first + 1);
    if (first < 1 || second < 0) continue;
    const file = record.slice(0, first);
    const text = record.slice(second + 1);
    if (COMMENT_LINE.test(text.trim())) continue;
    const hits = text.match(counter)?.length ?? 0;
    if (hits > 0) counts.set(file, (counts.get(file) ?? 0) + hits);
  }
  return counts;
}

function widgetPathspecs(): string[] {
  return WIDGET_ROOTS.flatMap((root) =>
    SEARCH_GLOBS.map((glob) => `${root}/${glob}`),
  );
}

function mismatches(
  allowed: Record<string, number>,
  counts: Map<string, number>,
): string[] {
  const out: string[] = [];
  for (const [file, used] of [...counts].sort()) {
    const budget = allowed[file];
    if (budget === undefined) {
      out.push(`  ${file}: ${used} (not allowed)`);
      continue;
    }
    if (used > budget) out.push(`  ${file}: ${used}, allowed ${budget}`);
  }
  for (const [file, budget] of Object.entries(allowed).sort()) {
    const used = counts.get(file) ?? 0;
    if (used < budget) out.push(`  ${file}: allowed ${budget}, uses ${used}`);
  }
  return out;
}

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: dirname(fileURLToPath(import.meta.url)),
  encoding: "utf8",
}).trim();

describe("every command's outcome reaches the operator", () => {
  const pass = repoPass(root);

  it("keeps a handle off the rail only where the outcome is drawn some other way", () => {
    const counts = countsByFile(pass, RAIL_OPT_OUT, SEARCH_GLOBS);
    const wrong = mismatches(RAIL_OPT_OUTS, counts);
    if (wrong.length > 0) {
      throw new Error(
        "`rail: false` keeps a command's refusals and losses off the panel " +
          "rail. Only a file that draws the outcome itself may pass it, and " +
          "RAIL_OPT_OUTS in packages/core/src/styleguide-command-rail.test.ts " +
          "must match what each file does:\n" +
          wrong.join("\n"),
      );
    }
    expect(wrong).toEqual([]);
  });

  it("has no allowance for a path that no longer exists", () => {
    const missing = [
      ...Object.keys(RAIL_OPT_OUTS),
      ...Object.keys(RAW_DISPATCHERS),
    ].filter((rel) => !existsSync(join(root, rel)));
    expect(missing).toEqual([]);
  });

  it("never dispatches from widget code past useCommand", () => {
    const counts = countsByFile(pass, RAW_DISPATCH, widgetPathspecs());
    const wrong = mismatches(RAW_DISPATCHERS, counts);
    if (wrong.length > 0) {
      throw new Error(
        "Widget code dispatched a command without `useCommand`, so nothing " +
          "puts its outcome on the rail. Use `useCommand(...).send(...)`, or " +
          "name a file that reports every outcome itself in RAW_DISPATCHERS:\n" +
          wrong.join("\n"),
      );
    }
    expect(wrong).toEqual([]);
  });

  it("can see both shapes (planted)", () => {
    const dir = mkdtempSync(join(tmpdir(), "command-rail-scan-"));
    try {
      writeFileSync(
        join(dir, "p.ts"),
        [
          'useCommand("a", { rail: false });',
          'useCommand("b", { vantage, rail:false }); useCommand("c", { rail : false });',
          "// rail: false written up is not an opt-out",
          ' * client.dispatch("x") inside a block comment is not one either',
          'client.dispatch("x", {}); dispatchActiveCommandTopic("y", {});',
          'telemetryClient.dispatch("z", {});',
        ].join("\n"),
      );
      const planted: GrepPass = (pattern) =>
        runGrep(dir, ["grep", "--no-index", "-nE", pattern, "--", "p.ts"]);
      expect(countsByFile(planted, RAIL_OPT_OUT, ["p.ts"]).get("p.ts")).toBe(3);
      expect(countsByFile(planted, RAW_DISPATCH, ["p.ts"]).get("p.ts")).toBe(3);
      expect(mismatches({ "p.ts": 2 }, new Map([["p.ts", 3]]))).toHaveLength(1);
      expect(
        mismatches({ "p.ts": 2, "gone.ts": 1 }, new Map([["p.ts", 2]])),
      ).toEqual(["  gone.ts: allowed 1, uses 0"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
