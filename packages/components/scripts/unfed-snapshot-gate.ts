/**
 * Un-fed snapshot gate: fails when a DOM snapshot test passes with every
 * fixture emit suppressed, stream and legacy data-source alike.
 *
 * A fixture-fed snapshot test that still passes when the fixture feeds it NOTHING is
 * capturing a render that contains none of that data, whatever its scenario is
 * called. Within the fixture-fed set (see `isFixtureFed`, which is what earns the
 * word) that is exact rather than heuristic: no copy to pattern-match, and nothing
 * for a widget's choice of placeholder to hide behind.
 *
 * It exists because two widgets had 96 committed baselines between them that were
 * renders of nothing:
 *
 *  - `AtmosphereProfile`: six scenarios named after six different atmospheres
 *    (`eve-thick-atmosphere`, `mun-vacuum`, ...), and all 48 renders were the
 *    string "ATMOSPHERE PROFILE Waiting for body telemetry..."
 *  - `SpaceCenterStatus`: 48 more, every facility level an em dash
 *
 * Both had a settle-check that waited for a stream-status badge to CLEAR. The badge
 * is the dashboard's, derived by the host from `dataRequirements`, so under a bare
 * widget harness it never renders at all and the wait is satisfied on the first
 * paint, before any emit. The flaw was diagnosed in a comment in
 * `DistanceToTarget/snapshots.test.tsx` and fixed only there, while the same wait
 * stayed load-bearing elsewhere.
 *
 * A textual detector found the first widget and missed the second, because one
 * empty state is a sentence and the other is punctuation. Suppressing the data
 * finds both, and would find the next one whatever it renders.
 *
 * ## How it runs
 *
 * `vitest run <snapshot specs> --reporter=json` twice is not needed: only the muted
 * run matters, because a snapshot test that fails when starved proves nothing about
 * itself either way, and one that passes is the finding. So this runs the snapshot
 * specs once with `GONOGO_MUTE_FIXTURE_EMITS=1` and reads which tests passed.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN_UNFED } from "./unfed-snapshot-debt";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Scenarios whose snapshot SHOULD be an empty render, with the reason. Keyed
 * `<widget dir>/<scenario>`, matched against the snapshot test's own name.
 *
 * A name alone is not enough: `no-contracts` is obvious today and will be argued
 * about in a year, so each entry says what the empty render is depicting. Adding an
 * entry is asserting "this widget genuinely has nothing to draw in this scenario",
 * which is a claim someone can check.
 *
 * To ratchet DOWN: when a scenario stops being an empty-state scenario, delete its
 * line and the gate holds it to a fed render from then on.
 */
const EMPTY_BY_DESIGN: Record<string, string> = {
  // Deliberately short. Three entries seeded here were removed on the gate's
  // first run because their scenarios turned out to depend on their emits after
  // all: `ContractManager/no-contracts` renders "0 offered" from the wire,
  // `ThermalStatus/no-thermal-data` renders from the sentinel readings, and
  // `DistanceToTarget/no-target` renders the tombstone's own age. All three are
  // fed renders, so allowlisting them would have granted a permission none of
  // them needed.
  "CommSignal/no-signal-data":
    "loss of signal is the scenario; the widget's subject is the absence",
  "ContractManager/awaiting-telemetry":
    "depicts the pre-telemetry placeholder deliberately, as its own case",
  "LaunchDirector/awaiting":
    "depicts the pre-telemetry placeholder deliberately, as its own case",
  "MapView/no-vessel-data":
    "no vessel position to plot, so the map draws its ground state only",
  "Objectives/empty":
    "no active objectives, which is a real state and not a missing read",
  "SemiMajorAxis/no-data":
    "no orbit to report; the widget is a single readout with nothing behind it",
  "Twr/engine-off-empty":
    "engines off, so there is genuinely no thrust-to-weight to show",
};

interface VitestJson {
  testResults?: Array<{
    name: string;
    assertionResults?: Array<{ fullName: string; status: string }>;
  }>;
}

/** `<widget dir>/<scenario>` for an allowlist lookup, or undefined if unparseable. */
function keyFor(file: string, fullName: string): string | undefined {
  const widget = /packages\/components\/src\/([^/]+)\//.exec(file)?.[1];
  if (widget === undefined) return undefined;
  // Names read "<Widget> DOM snapshots <scenario> @ <mode>", so drop the suite
  // prefix up to and including "snapshots " before taking the scenario.
  const scenario = /snapshots?\s+(.+?)\s+@\s+[^@]+$/.exec(fullName)?.[1];
  if (scenario === undefined) return undefined;
  return `${widget}/${scenario.trim()}`;
}

/**
 * Snapshot specs the gate can speak about: the ones whose data reaches the
 * widget through a path the mute actually covers.
 *
 * That is `setupStreamFixture` (a hand-rolled stream) OR `snapshotWidgetMode` /
 * `renderWidgetMode` (the shared DOM harness, whose `MockDataSource` seeding
 * and legacy-key reshapes are both muted alongside the stream). A spec matching
 * none of the three feeds its subject some other way, so starving proves
 * nothing about it: `Navball/snapshots.test.ts` and `ShipMap/snapshots.test.ts`
 * serialise an SVG from props with no data source in the picture at all, and
 * they are the reason this is a predicate rather than "every spec".
 *
 * Naming the harness here as well as the stream is a widening, and the
 * measurement that prompted it is the argument for it. The earlier version
 * asked only about `setupStreamFixture` and so declined to speak about 220 of
 * the suite's 1052 snapshot assertions, on the reasoning that "several widgets
 * render real content with no stream at all, because their content does not
 * come from the stream: `KeplerPeriod` plots a curve from a static body table,
 * `ActionGroup` renders from its own config". Starved of BOTH halves, 88 of
 * those 220 still passed, and `KeplerPeriod`'s 48 committed baselines turned
 * out to be one byte-identical blank panel repeated across six scenarios and
 * eight sizes. The exemption was reasoning about what the widgets would draw
 * rather than measuring it, which is the same mistake one level up as the
 * blank baselines it was written to catch.
 *
 * Inside this set the inference holds with no judgement in the middle: the
 * fixture declares its data, the harness delivers it, and if suppressing it
 * changes nothing then the committed baseline contains none of that data.
 */
function isFixtureFed(file: string): boolean {
  try {
    const src = readFileSync(file, "utf8");
    return (
      src.includes("setupStreamFixture") ||
      src.includes("snapshotWidgetMode") ||
      src.includes("renderWidgetMode")
    );
  } catch {
    return false;
  }
}

function main(): void {
  const outDir = mkdtempSync(join(tmpdir(), "unfed-gate-"));
  const outFile = join(outDir, "muted.json");
  try {
    try {
      execFileSync(
        "pnpm",
        [
          "exec",
          "vitest",
          "run",
          "--silent",
          "--reporter=json",
          `--outputFile=${outFile}`,
          "snapshots",
        ],
        {
          cwd: packageRoot,
          env: { ...process.env, GONOGO_MUTE_FIXTURE_EMITS: "1" },
          stdio: ["ignore", "ignore", "inherit"],
        },
      );
    } catch {
      // A non-zero exit is EXPECTED and is the healthy case: starved snapshot
      // tests should fail. The report is what matters, so only its absence is
      // fatal.
    }

    if (!existsSync(outFile)) {
      throw new Error(
        "unfed-snapshot-gate: vitest produced no JSON report, so the gate could " +
          "not run. That is a failure of the gate, not a pass: fix the run rather " +
          "than ignoring it.",
      );
    }

    const report = JSON.parse(readFileSync(outFile, "utf8")) as VitestJson;
    /** Scenario key -> how many of its modes passed while starved. */
    const unfedByKey = new Map<string, number>();
    const allowlistHits = new Set<string>();
    let checked = 0;
    for (const file of report.testResults ?? []) {
      for (const test of file.assertionResults ?? []) {
        if (!/snapshot/i.test(file.name)) continue;
        if (!isFixtureFed(file.name)) continue;
        checked += 1;
        if (test.status !== "passed") continue;
        const key = keyFor(file.name, test.fullName);
        if (key !== undefined && key in EMPTY_BY_DESIGN) {
          allowlistHits.add(key);
          continue;
        }
        const bucket = key ?? file.name;
        unfedByKey.set(bucket, (unfedByKey.get(bucket) ?? 0) + 1);
      }
    }

    if (checked === 0) {
      throw new Error(
        "unfed-snapshot-gate: matched no snapshot tests at all, so it checked " +
          "nothing. A gate that inspects an empty set reports success for the " +
          "wrong reason; fix the spec filter.",
      );
    }

    // Ratchet DOWN as well as up: an entry that stops matching means the scenario
    // was renamed, deleted, or now renders data, and a list that quietly keeps
    // permissions nobody uses is how the next blank render gets waved through.
    const stale = Object.keys(EMPTY_BY_DESIGN).filter(
      (key) => !allowlistHits.has(key),
    );
    if (stale.length > 0) {
      console.error(
        `unfed-snapshot-gate: ${stale.length} EMPTY_BY_DESIGN entr(ies) no longer\n` +
          `match any starved-but-passing snapshot test:\n` +
          `${stale.map((key) => `  ${key}`).join("\n")}\n\n` +
          `Each has been renamed, deleted, or now renders real data. Delete the\n` +
          `line(s) from packages/components/scripts/unfed-snapshot-gate.ts to\n` +
          `ratchet the gate down; leaving them keeps a permission nobody is using.`,
      );
      process.exit(1);
    }

    // ---- shrink-only debt ----------------------------------------------
    //
    // Seeded at the 96 renders that were already un-fed when the gate landed. The
    // gate holds the list from both sides so it can only ever get smaller, and so
    // `test` stays a working signal instead of going permanently red the way
    // `visual` has been since 10 August.
    const regressions: string[] = [];
    const fixed: string[] = [];
    for (const [key, count] of unfedByKey) {
      const owed = KNOWN_UNFED[key];
      if (owed === undefined) {
        regressions.push(`  ${String(count).padStart(3)}  ${key}  (new)`);
      } else if (count !== owed) {
        // A count that GREW is a regression; one that shrank is progress that
        // still has to be recorded, so both land here and both name the numbers.
        regressions.push(
          `  ${String(count).padStart(3)}  ${key}  (recorded as ${owed})`,
        );
      }
    }
    for (const key of Object.keys(KNOWN_UNFED)) {
      if (!unfedByKey.has(key)) fixed.push(`  ${key}`);
    }

    if (fixed.length > 0) {
      console.error(
        `unfed-snapshot-gate: ${fixed.length} recorded un-fed scenario(s) now\n` +
          `render their data:\n${fixed.join("\n")}\n\n` +
          `That is the good direction. Delete the line(s) from\n` +
          `packages/components/scripts/unfed-snapshot-debt.ts so the debt shrinks;\n` +
          `the list may only ever get smaller, and leaving a fixed entry in it keeps\n` +
          `a permission nobody needs.`,
      );
      process.exit(1);
    }

    if (regressions.length > 0) {
      console.error(
        `unfed-snapshot-gate: ${regressions.length} snapshot scenario(s) PASSED with\n` +
          `every stream emit suppressed and are not recorded as known debt, so they\n` +
          `are capturing an un-fed render: the committed baseline is the widget's\n` +
          `empty state, not the scenario it is named after.\n\n` +
          `${regressions.join("\n")}\n\n` +
          `Either the fixture's data never reaches the widget (fix the fixture or\n` +
          `the harness, then the baseline becomes a real render), or the scenario\n` +
          `genuinely has nothing to draw, in which case add it to EMPTY_BY_DESIGN\n` +
          `in packages/components/scripts/unfed-snapshot-gate.ts WITH a clause\n` +
          `saying what the empty render depicts.\n\n` +
          `Do NOT regenerate a baseline to clear this. Regenerating would adopt\n` +
          `the blank render as the expected one and retire the only check that\n` +
          `noticed it was blank. Do NOT add it to unfed-snapshot-debt.ts either:\n` +
          `that list is seeded and shrink-only, never a place to park a new one.`,
      );
      process.exit(1);
    }

    const owedTotal = Object.values(KNOWN_UNFED).reduce((a, b) => a + b, 0);
    console.log(
      `unfed-snapshot-gate: ${checked} fixture-fed snapshot test(s) checked. ` +
        `Every one that renders data fails when starved of it, except ${owedTotal} ` +
        `recorded as known un-fed debt (unfed-snapshot-debt.ts, shrink-only).`,
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

main();
