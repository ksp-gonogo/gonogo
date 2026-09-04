import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A reckoned point is a presentation-time projection, and this is the ratchet
 * that keeps it one.
 *
 * `TimelineStore.sampleReckonedTail` mints values for instants nothing arrived
 * at. They are honest where they are drawn, beside a dash and a named model,
 * and they are a lie anywhere that answers "what did the craft report": a
 * store, a recording, an export, a threshold, an alarm. The type already helps
 * (`ReckonedSample` is not a `TimelinePoint`, so nothing that takes points will
 * take one), but a type cannot stop a second consumer copying the values into a
 * shape that IS an observation, which is the move this exists to notice.
 *
 * So the containment is a COUNT of call sites rather than a rule about what
 * they do. One producer, one consumer, and the consumer is the hook that builds
 * a series for a chart. A second one is not forbidden, it is a decision, and it
 * fails here until somebody writes down which surface is being handed a value
 * nobody measured and why that surface can carry it.
 *
 * The shape of `MissionHistorySource.queryRange` is the case worth naming: it
 * replays a derived channel through `sampleDerivedRange` and must keep doing
 * exactly that. A recording that grew a modelled tail would export instants the
 * craft never sent, into a file that outlives the frame it was true for.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

/** Where the method is declared, and the one place it is called from. */
const SANCTIONED = new Set([
  "mod/sitrep-sdk/src/spine/timeline-store.ts",
  "packages/data/src/hooks/useDataSeries.ts",
]);

const IS_TEST = /\.(test|test-d)\.tsx?$/;

/**
 * Files that CALL or DECLARE it, not files that mention it.
 *
 * A bare name match counted three doc comments that name the method to explain
 * why they are not it, which is exactly the prose the rule wants written. A
 * call and a declaration both put a `(` or a type argument straight after the
 * name; a sentence about it does not.
 */
function filesCalling(symbol: string): string[] {
  const out = execFileSync(
    "git",
    ["grep", "-lE", `${symbol}[<(]`, "--", "*.ts", "*.tsx"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return out.split("\n").filter((line) => line.length > 0);
}

function unsanctioned(files: readonly string[]): string[] {
  return files.filter((f) => !IS_TEST.test(f) && !SANCTIONED.has(f)).sort();
}

describe("a reckoned point reaches the chart and nothing else", () => {
  it("is produced in one place and consumed in one place", () => {
    const files = filesCalling("sampleReckonedTail");
    /*
     * The scan can see its subject at all: a `git grep` that silently matches
     * nothing reports a clean tree, which is the failure mode every ratchet in
     * this package is written against.
     */
    expect(files.length).toBeGreaterThan(0);
    expect(unsanctioned(files)).toEqual([]);
  });

  it("can see an unsanctioned caller, so a clean result means something", () => {
    // Planted rather than assumed. The check above passes trivially if the
    // classifier lets everything through, and a guard that cannot fail is a
    // guard that reports zero for ever.
    expect(
      unsanctioned([
        "mod/sitrep-sdk/src/spine/timeline-store.ts",
        "packages/data/src/FlightsManager/MissionHistorySource.ts",
      ]),
    ).toEqual(["packages/data/src/FlightsManager/MissionHistorySource.ts"]);
  });
});
