import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every production reader of the received edge, `useViewUt()` or `getViewUt()`,
 * is on a reviewed list with the reason it wants that instant rather than the
 * craft's present.
 *
 * Readings reckon to SCET, so a widget that solves geometry or counts down to
 * an event at the craft against the received edge draws two instants side by
 * side, and nothing else catches it: both hooks answer a plausible UT. Geometry
 * and countdowns belong on `useScetUt`/`getScetUt`; what stays here is the age
 * of an observation, a clock an alarm fires on, and the host plumbing that
 * forwards the hook.
 */

const CALL = /(?<!function\s)\b(useViewUt|getViewUt)\(/g;

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

const RECEIVED_EDGE_READERS: Record<string, { count: number; why: string }> = {
  "packages/app/src/alarms/AlarmHostService.ts": {
    count: 2,
    why: "an alarm fires on the arrival clock",
  },
  "packages/app/src/goNoGo/GoNoGoComponent.tsx": {
    count: 1,
    why: "the vote clock is the console's own",
  },
  "packages/app/src/goNoGo/GoNoGoHostService.ts": {
    count: 1,
    why: "the vote clock is the console's own",
  },
  "packages/app/src/uplinks/host.ts": {
    count: 1,
    why: "forwards the hook onto the author host",
  },
  "packages/components/src/ContractManager/ContractManagerView.tsx": {
    count: 1,
    why: "contract deadlines are held at the space centre, not the craft",
  },
  "packages/components/src/FleetRoster/FleetContactCell.tsx": {
    count: 1,
    why: "a contact schedule is about when the link's word arrives",
  },
  "packages/components/src/LaunchDirector/useFlightState.ts": {
    count: 1,
    why: "orders crash snapshots and keeps mission time on the delayed banner clock",
  },
  "packages/components/src/MapView/useMapTelemetry.ts": {
    count: 1,
    why: "measures how far the observed position is behind SCET",
  },
  "packages/components/src/WarpControl/NextAlarm.tsx": {
    count: 1,
    why: "an alarm fires on the arrival clock",
  },
  "packages/components/src/shared/usePastTrack.ts": {
    count: 1,
    why: "observed history only exists up to the received edge",
  },
  "packages/data/src/replaySession/ReplaySessionBanner.tsx": {
    count: 1,
    why: "a replay's position is the view being scrubbed",
  },
  "mod/sitrep-sdk/src/api/host.ts": {
    count: 1,
    why: "declares the hook on the author host",
  },
  "mod/sitrep-sdk/src/api/index.ts": {
    count: 2,
    why: "the author barrel's hook, and a plan's age when it is sent",
  },
  "mod/sitrep-sdk/src/testing/install-real-test-host.ts": {
    count: 1,
    why: "forwards the hook onto the test host",
  },
};

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function countCalls(source: string): number {
  return [...withoutComments(source).matchAll(CALL)].length;
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
      const count = countCalls(readFileSync(file, "utf8"));
      if (count > 0) counts[relative(root, file)] = count;
    }
  }
  return counts;
}

describe("received-edge readers are a reviewed list", () => {
  it("sees a call and not a definition or a mention in a comment", () => {
    expect(countCalls("const ut = useViewUt()?.magnitude;")).toBe(1);
    expect(countCalls("const ut = getViewUt();")).toBe(1);
    expect(countCalls("export function useViewUt(): Value<'ut'> {")).toBe(0);
    expect(countCalls("// read `useViewUt()` for an age")).toBe(0);
    expect(countCalls("/** see `getViewUt()` */")).toBe(0);
  });

  it("finds exactly the listed readers", () => {
    const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
    const found = scanReaders(root);
    const unlisted = Object.keys(found).filter(
      (file) => found[file] !== RECEIVED_EDGE_READERS[file]?.count,
    );
    const gone = Object.keys(RECEIVED_EDGE_READERS).filter(
      (file) => !(file in found),
    );
    expect(
      unlisted.map((file) => `${file}: ${found[file]}`),
      [
        "A new reader of the received edge, or a changed count. Geometry and",
        "countdowns to an event at the craft read useScetUt/getScetUt; list a",
        "file here only when it genuinely wants the received edge, and say why.",
      ].join("\n"),
    ).toEqual([]);
    expect(gone, "Listed readers that no longer read it: drop them.").toEqual(
      [],
    );
  });
});
