import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Declining ratchet: a unit must reach the DOM through `Unit`/`Quantity`, not
 * as a template literal.
 *
 * `formatQuantity` returns `{ value, symbol }` as two parts on purpose, so the
 * symbol can be dimmed, kept off a line break, and above all ANNOUNCED as a
 * word rather than as letters. A call site that writes `` `${value} ${symbol}` ``
 * throws all three away, and the result is indistinguishable from a hand-rolled
 * formatter at the point of use.
 *
 * This guard exists because of a specific failure, and the failure was in the
 * reporting rather than in the code. Two other ratchets in this directory had
 * been driven to zero (`styleguide-shadowed-primitives`, the contract's unit
 * coverage) and that was taken as evidence the kit was adopted. It was not:
 * those count NAME COLLISIONS and CONTRACT ANNOTATIONS. Nobody had counted how
 * many readouts actually routed a value through the unit layer, and when
 * somebody finally did, `Unit` was used in one production widget and eleven
 * sites were joining the parts back into strings.
 *
 * So the number lives here now, and it can only go down. A ratchet that
 * measures the thing you want to claim is worth more than three that measure
 * something adjacent to it.
 *
 * **What counts as an offender**: joining `formatQuantity`'s value and symbol
 * into one string. **What does not**: `speakQuantity`, which is the sanctioned
 * way to get a string for an `aria-label` or a `title`, and which uses the word
 * rather than the symbol.
 */

// Matches `${value} ${symbol}` and `${value}${symbol}` in a template literal,
// which is the exact shape every offender took.
const JOIN = String.raw`\$\{value\} ?\$\{symbol\}`;

/**
 * Per-file counts of the remaining joins. Every one is a `format*(): string`
 * helper whose callers interpolate the result, so converting one means
 * converting its call sites too, which is why they are being retired in
 * batches rather than all at once.
 *
 * To lower an entry: convert the helper to return a `<Quantity>` (or use
 * `speakQuantity` if the caller genuinely needs a string), update the callers,
 * and drop the count. Never raise one.
 */
const BASELINE: Record<string, number> = {
  "packages/components/src/AtmosphereProfile/index.tsx": 2,
  "packages/components/src/ContractManager/index.tsx": 1,
  "packages/components/src/GroundSurvey/index.tsx": 1,
  "packages/components/src/LandingStatus/index.tsx": 1,
  "packages/components/src/LaunchDirector/index.tsx": 1,
  "packages/components/src/SystemView/AlmanacPanel.tsx": 2,
  "packages/core/src/orbital.ts": 1,
};

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

function countsByFile(root: string): Record<string, number> {
  let out: string;
  try {
    out = execFileSync("git", ["grep", "-c", "-E", JOIN, "--", "packages"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 16,
    });
  } catch (err) {
    // git grep exits 1 when nothing matches anywhere, which is the goal state.
    if ((err as { status?: number }).status === 1) return {};
    throw err;
  }
  const counts: Record<string, number> = {};
  for (const line of out.split("\n").filter(Boolean)) {
    const at = line.lastIndexOf(":");
    const file = line.slice(0, at);
    if (file.includes(".test.") || file.includes("/dist/")) continue;
    counts[file] = Number(line.slice(at + 1));
  }
  return counts;
}

const root = repoRoot(dirname(fileURLToPath(import.meta.url)));
const counts = countsByFile(root);

describe("design-system: units reach the DOM through the unit layer", () => {
  it("adds no new place that joins a value and its symbol into a string", () => {
    const added: string[] = [];
    for (const [file, count] of Object.entries(counts)) {
      const allowed = BASELINE[file] ?? 0;
      if (count > allowed) {
        added.push(`  ${file}: ${count} (baseline ${allowed})`);
      }
    }
    if (added.length > 0) {
      throw new Error(
        "A value and its unit symbol were joined into a string. Render " +
          '<Quantity value={n} unit="m" /> instead, so the symbol keeps its ' +
          "styling and the unit is announced as a word rather than as " +
          "letters. Where a string is genuinely required (aria-label, title), " +
          `use speakQuantity.\n${added.join("\n")}`,
      );
    }
    expect(added).toEqual([]);
  });

  it("has no stale baseline entry", () => {
    // A file that got converted must leave the list, or the ratchet stops
    // ratcheting: it would silently allow a join to come back.
    const stale = Object.keys(BASELINE).filter(
      (file) => (counts[file] ?? 0) < BASELINE[file],
    );
    if (stale.length > 0) {
      throw new Error(
        "These are below their baseline, which is good. Lower or remove the " +
          `entry in BASELINE so the gain is locked in:\n${stale
            .map(
              (f) => `  ${f}: now ${counts[f] ?? 0}, baseline ${BASELINE[f]}`,
            )
            .join("\n")}`,
      );
    }
    expect(stale).toEqual([]);
  });
});
