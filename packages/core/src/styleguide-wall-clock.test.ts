import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Wall-clock allowlist: keep `Date.now()` out of any currency computation in
 * `packages/components/`.
 *
 * A widget rendering how old a reading is has exactly one legitimate "now": the
 * FRAME's view time (`useViewUt`), which every read in a frame shares. Wall
 * clock is the available wrong answer, and it is wrong in a way that is hard to
 * see: two readouts in the same widget, in the same frame, can disagree about
 * how old the same sample is, because each called `Date.now()` at a different
 * instant. That is exactly the class of bug `FrameToken` and the
 * single-view-time invariant exist to prevent, and under a signal delay it also
 * silently conflates UT with wall time.
 *
 * This ratchet exists BEFORE the `Reading<T>` sweep rather than after it,
 * deliberately: the sweep touches thirty-nine widgets and each one grows an
 * age rendering. A guardrail landed afterwards is a guardrail that has to be
 * paid for twice.
 *
 * Wall clock is NOT banned outright, because some uses are honestly about wall
 * time: a UI dwell timer, a spinner's own age, an injectable clock seam, an id
 * generator. Those are enumerated below with a one-line justification each.
 * Anything new fails the build until a human either routes it through
 * `useViewUt` or adds a line here saying why it is about wall time and not
 * about how current a value is.
 *
 * Same ratchet shape as `truenow-allowlist.test.ts` (seeded per-file counts,
 * fails on new, changed or stale entries), and its walk/root helpers are
 * copied rather than shared for the same reason that file gives: each ratchet
 * keeps its own scaffolding so a change to one cannot silently reshape the
 * other's scan.
 */

// The three wall-clock reads. `performance.now()` is included because it is the
// same mistake with a monotonic clock: still not the frame's view time.
// Comments are stripped before matching, so a doc comment that NAMES
// `Date.now()` to warn against it does not count as a use of it.
const WALL_CLOCK = /(?<![.\w])(?:Date\.now|performance\.now)\s*\(\s*\)/g;
const BARE_NEW_DATE = /new Date\s*\(\s*\)/g;

const SCAN_EXTENSION = /\.tsx?$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "__fixtures__", "test"]);
// Tests, snapshots and probe harnesses pin or fake time on purpose.
const SKIP_FILE = /\.(test|test-d)\.tsx?$/;

// ---------------------------------------------------------------------
// Seeded allowlist: one entry per production file under
// packages/components/src that legitimately reads a wall clock, with the
// count and the reason. A file scoring 0 has no entry.
// ---------------------------------------------------------------------
const ALLOWED_WALL_CLOCK: Record<string, number> = {
  // A UI dwell: `completedAt` holds the "burn complete" marker on screen for
  // COMPLETED_HOLD_MS after the fact, and the remaining hold is wall-time
  // arithmetic on that same wall-time stamp. Nothing here describes how
  // current a telemetry value is. 2 reads.
  "packages/components/src/ManeuverPlanner/BurnCompletionTracker.ts": 2,

  // One injectable clock seam (`opts.nowMs ?? (() => Date.now())`, which is how
  // its own tests pin time) plus an id generator's entropy source. Neither is a
  // currency computation. 2 reads.
  "packages/components/src/ManeuverPlanner/LocalManeuverTriggerService.ts": 2,

  // `since` on the pending-click spinner: how long ago the OPERATOR clicked,
  // which is a fact about this browser session and not about any sample's age.
  // Backs a 5 s safety net that clears the spinner if the readback never
  // lands. 3 reads.
  "packages/components/src/TargetPicker/index.tsx": 3,

  // The live time-series x-axis window. Flagged rather than endorsed: plotting
  // samples against wall clock means that under a signal delay the newest
  // sample sits behind the right edge by one delay, so the graph shows a
  // permanent empty gutter and the axis labels are wall time against UT data.
  // Pre-dates this ratchet and is its own piece of work (the axis wants the
  // frame's view time, and the samples want their own `validAt`); allowlisted
  // so the ratchet can land without dragging that fix in. 1 read.
  "packages/components/src/Graph/index.tsx": 1,

  // Throttling how often an expensive solve may RUN, which is wall-time by
  // nature: the projection is rebuilt at most once a real second whatever the
  // warp. The frame's view time is the wrong clock here rather than the right
  // one, and specifically so: game UT is what stops throttling above 60x warp,
  // which is the defect this floor exists to fix. Nothing here describes how
  // current a value is. The throttle itself takes the instant as an argument
  // and reads no clock, so this is the only read. 1 read.
  "packages/components/src/SystemView/index.tsx": 1,
};

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      yield* walk(path);
    } else if (SCAN_EXTENSION.test(name) && !SKIP_FILE.test(name)) {
      yield path;
    }
  }
}

/**
 * Strip comments so a doc comment warning against `Date.now()` (this ratchet's
 * whole point is that such comments should exist) is not itself counted as a
 * use. Crude on purpose: a `//` or `/* *\/` inside a string literal would be
 * over-stripped, which can only ever UNDER-count, and an under-count fails the
 * ratchet loudly rather than passing something through silently.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** repo-relative path -> wall-clock read count, for every scanned file scoring > 0. */
function scanWallClock(root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const srcDir = join(root, "packages", "components", "src");
  if (!existsSync(srcDir)) return counts;
  for (const file of walk(srcDir)) {
    const content = stripComments(readFileSync(file, "utf8"));
    const total =
      [...content.matchAll(WALL_CLOCK)].length +
      [...content.matchAll(BARE_NEW_DATE)].length;
    if (total > 0) counts[relative(root, file)] = total;
  }
  return counts;
}

describe("wall-clock allowlist: currency is measured against the frame, never Date.now()", () => {
  it("matches the seeded allowlist exactly", () => {
    const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
    const found = scanWallClock(root);

    const newOrChanged = Object.keys(found).filter(
      (file) => found[file] !== ALLOWED_WALL_CLOCK[file],
    );
    const stale = Object.keys(ALLOWED_WALL_CLOCK).filter(
      (file) => !(file in found),
    );

    if (newOrChanged.length > 0) {
      const lines = newOrChanged.map((file) => {
        const expected = ALLOWED_WALL_CLOCK[file];
        return expected === undefined
          ? `  ${file}: ${found[file]} wall-clock read(s), no allowlist entry`
          : `  ${file}: expected ${expected}, found ${found[file]}`;
      });
      throw new Error(
        `Wall-clock read count changed or is new in the following file(s):\n` +
          `${lines.join("\n")}\n\n` +
          `If this is a CURRENCY computation (how old a reading is, whether a ` +
          `value is still good, an age or a countdown against telemetry), it ` +
          `must measure against the frame's view time: read \`useViewUt()\` and ` +
          `use \`readingAge\`. Every read in a frame then agrees, which is what ` +
          `the single-view-time invariant is for.\n\n` +
          `If it genuinely is about WALL time (a UI dwell, a spinner's own age, ` +
          `an injectable clock seam, an id generator), add or bump its line in ` +
          `packages/core/src/styleguide-wall-clock.test.ts WITH a one-line ` +
          `justification.`,
      );
    }

    if (stale.length > 0) {
      const lines = stale.map(
        (file) =>
          `  ${file}: allowlisted for ${ALLOWED_WALL_CLOCK[file]}, found 0`,
      );
      throw new Error(
        `Stale ALLOWED_WALL_CLOCK entries: these file(s) no longer read a wall ` +
          `clock (removed, migrated to the view clock, moved or deleted). ` +
          `Delete the line(s) from ` +
          `packages/core/src/styleguide-wall-clock.test.ts to ratchet the gate ` +
          `down:\n${lines.join("\n")}`,
      );
    }

    expect(newOrChanged).toEqual([]);
    expect(stale).toEqual([]);
  });
});
