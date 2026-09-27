import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Nothing outside the sdk's reckoning machinery reads the craft's present (SCET)
 * or the command-arrival instant directly.
 *
 * Every reading is current as received at the command vantage, so a widget
 * draws the observation at the received edge. A figure at the craft's present
 * comes only from a Reading's reckoning, which carries its own instant and is
 * drawn with the modelled mark. Solving or counting down against a bare SCET
 * propagates without a model and draws the result unmarked.
 */

const DIRECT_READ =
  /(?<!function\s)\b(useScetUt|getScetUt|useCommandArrivalUt|getCommandArrivalUt)\s*\(|\.(scetUt|commandArrivalUt)\b/g;

const SCAN_ROOTS = ["packages", "mod"];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "bin",
  "obj",
  "scripts",
  "__generated__",
  "test",
]);
const SOURCE = /\.(ts|tsx)$/;
const TEST_FILE = /\.test\.|\.test-d\./;
const MACHINERY = "mod/sitrep-sdk/src/spine/";

const PENDING = "command planning at the arrival instant, held for a ruling";
const MOVING = "moves to the received edge in this branch";

/** Readers still to go, each with why it is here. Shrink-only. */
const DIRECT_READERS: Record<string, { count: number; why: string }> = {
  "packages/app/src/maneuverTriggers/ManeuverTriggerHostService.ts": {
    count: 1,
    why: PENDING,
  },
  "packages/components/src/ManeuverPlanner/LocalManeuverTriggerService.ts": {
    count: 1,
    why: PENDING,
  },
  "packages/components/src/ManeuverPlanner/usePlannerTelemetry.ts": {
    count: 2,
    why: `${PENDING}; its display instant ${MOVING}`,
  },
  "packages/core/src/hooks/useOrbitSolve.ts": { count: 1, why: PENDING },
  "packages/app/src/uplinks/host.ts": { count: 1, why: MOVING },
  "packages/components/src/Targeting/useTargetingReading.ts": {
    count: 1,
    why: MOVING,
  },
  "mod/sitrep-sdk/src/api/host.ts": { count: 1, why: MOVING },
  "mod/sitrep-sdk/src/api/index.ts": { count: 1, why: MOVING },
  "mod/sitrep-sdk/src/testing/install-real-test-host.ts": {
    count: 1,
    why: MOVING,
  },
};

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function countReads(source: string): number {
  return [...withoutComments(source).matchAll(DIRECT_READ)].length;
}

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
    if (statSync(path).isDirectory()) {
      yield* walk(path);
      continue;
    }
    if (SOURCE.test(name) && !TEST_FILE.test(name)) yield path;
  }
}

function scanReaders(root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const scanRoot of SCAN_ROOTS) {
    const dir = join(root, scanRoot);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const path = relative(root, file);
      if (path.startsWith(MACHINERY)) continue;
      const count = countReads(readFileSync(file, "utf8"));
      if (count > 0) counts[path] = count;
    }
  }
  return counts;
}

describe("no direct read of the SCET or command-arrival instant", () => {
  it("sees a hook, an accessor and a frame field, and not a definition or a comment", () => {
    expect(countReads("const ut = useScetUt()?.magnitude;")).toBe(1);
    expect(countReads("const ut = getCommandArrivalUt();")).toBe(1);
    expect(countReads("solveOrbit(o, frame.scetUt, r);")).toBe(1);
    expect(countReads("const m = at - ctx.frame.commandArrivalUt;")).toBe(1);
    expect(countReads("clock.scetUt(clock.viewUt())")).toBe(1);
    expect(countReads("export function useScetUt(): Value<'ut'> {")).toBe(0);
    expect(countReads("// solve at `useScetUt()`")).toBe(0);
    expect(countReads("/** see `frame.scetUt` */")).toBe(0);
    expect(countReads("const ut = useViewUt();")).toBe(0);
  });

  it("finds exactly the listed readers", () => {
    const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
    const found = scanReaders(root);
    const unlisted = Object.keys(found).filter(
      (file) => found[file] !== DIRECT_READERS[file]?.count,
    );
    const gone = Object.keys(DIRECT_READERS).filter((file) => !(file in found));
    expect(
      unlisted.map((file) => `${file}: ${found[file]}`),
      [
        "A new direct read of SCET or the command-arrival instant, or a changed",
        "count. Draw the observation at the received edge (useViewUt), and take",
        "a figure at the craft's present from a Reading's reckoning",
        "(deriveReading), drawn with the modelled mark.",
      ].join("\n"),
    ).toEqual([]);
    expect(gone, "Listed readers that no longer read it: drop them.").toEqual(
      [],
    );
  });
});
