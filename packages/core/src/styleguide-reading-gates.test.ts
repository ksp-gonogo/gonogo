import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { READING_GATE_DEBT } from "./styleguide-reading-gates.allowlist";

/**
 * A `Reading` used as a truthiness or nullish gate, which is a gate that no
 * longer gates.
 *
 * ## The failure this exists for, which the compiler does NOT catch
 *
 * `useTelemetry` returns a `Reading`, so it is an object and it is ALWAYS
 * truthy and never nullish. Every gate written against the old bare-payload
 * shape therefore stops working, silently, while remaining perfectly legal
 * TypeScript:
 *
 *   const available = useTelemetry("robotics.available");
 *   if (available === undefined) return null;   // never fires: FAILS OPEN
 *
 *   const orbit = useTelemetry("vessel.orbit");
 *   if (!orbit) return EMPTY;                   // never fires: FAILS OPEN
 *
 *   const parts = useTelemetry("vessel.parts");
 *   (parts ?? []).filter(...)                   // never takes the fallback
 *
 * That is the whole point of this file. The migration's central premise is that
 * the compile break finds every site, and for this class it does not: comparing
 * an object to `undefined` is legal, negating one is legal, and `??` on one is
 * legal. A real instance shipped and was caught by a widget test rather than by
 * `tsc` (`MapPoiLayer`'s `requires` gate, which began rendering every gated
 * provider unconditionally).
 *
 * ## What it cannot catch, said plainly
 *
 * This is a TEXT SCAN over a regex, not type analysis, so it is approximate in
 * both directions and the blind spots are the point of naming them:
 *
 * - it only follows a variable assigned DIRECTLY from a one-line
 *   `const x = useTelemetry(...)`. A reading passed to a function, stored on an
 *   object, destructured, or assigned across two lines is invisible to it
 * - it cannot tell a reading-valued variable from one that was narrowed first,
 *   so a legitimate `if (!value)` AFTER a `state` branch reads as a violation
 *   and needs an allowlist line
 * - it says nothing about the far larger class of sites that reach `.value`
 *   without branching at all, because a text scan cannot see whether a
 *   discriminant was written. That is what the type system DOES catch, which is
 *   why this file is scoped to the part it does not
 *
 * An approximate guard that names its own blind spots is worth having; the
 * failures this repo has actually paid for were the guards that could not
 * express their own failure mode at all.
 */

const PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly of: (name: string) => RegExp;
}> = [
  { label: "=== undefined", of: (n) => new RegExp(`\\b${n} === undefined`) },
  { label: "!== undefined", of: (n) => new RegExp(`\\b${n} !== undefined`) },
  { label: "== null", of: (n) => new RegExp(`\\b${n} == null`) },
  { label: "!= null", of: (n) => new RegExp(`\\b${n} != null`) },
  { label: "if (x)", of: (n) => new RegExp(`if \\(${n}\\)`) },
  { label: "!x", of: (n) => new RegExp(`!${n}\\b(?!\\.)`) },
  { label: "x ?? y", of: (n) => new RegExp(`\\b${n} \\?\\? `) },
];

const ASSIGNED = /^\s*const (\w+) = useTelemetry(?:<[^>]*>)?\([^)]*\);\s*$/;

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: dirname(fileURLToPath(import.meta.url)),
    encoding: "utf8",
  }).trim();
}

/** Every source file that calls the hook, tracked or not, from git rather than a walk. */
function candidateFiles(root: string): string[] {
  const out = execFileSync(
    "git",
    // `--untracked` is load-bearing: `git grep` alone searches only
    // TRACKED files, so a violation introduced in a BRAND-NEW file is
    // invisible to this scan until the moment it is staged, and a local
    // run before `git add` reports success while not looking at it. It
    // still honours .gitignore, so build output stays out.
    ["grep", "--untracked", "-l", "useTelemetry(", "--", "*.ts", "*.tsx"],
    { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 },
  );
  return out
    .split("\n")
    .filter(Boolean)
    .filter((f) => !/\.test\.tsx?$|\.test-d\.tsx?$/.test(f));
}

/** Not exported: biome forbids exports from a test file, and nothing outside needs it. */
interface ReadingGate {
  at: string;
  variable: string;
  pattern: string;
}

function findGates(root: string): ReadingGate[] {
  const found: ReadingGate[] = [];
  for (const file of candidateFiles(root)) {
    const lines = readFileSync(join(root, file), "utf8").split("\n");
    const assigned = new Map<string, number>();
    lines.forEach((line, i) => {
      const m = ASSIGNED.exec(line);
      if (m) assigned.set(m[1], i + 1);
    });
    if (assigned.size === 0) continue;
    lines.forEach((line, i) => {
      // Comments are where this class gets DISCUSSED, so scanning them produces
      // a violation for every note explaining the violation.
      const code = line.split("//")[0];
      for (const [name, declaredAt] of assigned) {
        if (i + 1 === declaredAt) continue;
        for (const { label, of } of PATTERNS) {
          if (of(name).test(code)) {
            found.push({
              at: `${file}:${i + 1}`,
              variable: name,
              pattern: label,
            });
          }
        }
      }
    });
  }
  return found;
}

const root = repoRoot();
const gates = findGates(root);

describe("styleguide: a Reading is never a gate", () => {
  it("has no reading used as a truthiness or nullish check outside the debt list", () => {
    const unlisted = gates
      .map((g) => g.at)
      .filter((at) => !READING_GATE_DEBT.includes(at))
      .sort();
    // Each of these is a gate that no longer gates. Branch on `state` instead:
    // `pending` is nothing-yet, `absent` is a confirmed nothing, and `stale` is
    // usually still true of the world for a presence or identity read.
    expect(unlisted).toEqual([]);
  });

  it("keeps no debt entry for a site that has been fixed", () => {
    // The ratchet half: fixing a site makes its line stale, and the test forces
    // the line out in the same commit. Without this the list would only ever
    // grow and would stop meaning anything.
    const live = new Set(gates.map((g) => g.at));
    const stale = READING_GATE_DEBT.filter((at) => !live.has(at)).sort();
    expect(stale).toEqual([]);
  });

  it("still finds something, so a broken scan cannot read as a clean codebase", () => {
    // The guard on the guard. If the assignment regex stops matching (a
    // formatter splitting the declaration across lines would do it) this file
    // would report zero violations forever and look like success.
    expect(gates.length + READING_GATE_DEBT.length).toBeGreaterThan(0);
  });
});
