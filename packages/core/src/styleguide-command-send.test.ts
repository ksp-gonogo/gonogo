// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  modClientRoots,
  SCANNED_PACKAGE_ROOTS,
  trackedModClientRoots,
  UNSCANNED_PACKAGE_ROOTS,
} from "./styleguideScanRoots";

/**
 * A command is sent from a kit input, not from a bare call.
 *
 * `dangerouslySendWithoutInput` sends a command with nothing on screen showing
 * the operator that it went, except the panel's delay rail. A control the
 * operator presses should take the command through its `command` prop instead,
 * so it draws sent, refused and the rest. This holds the remaining bare sends
 * to an exact list: a file above its count, a file not on the list and an entry
 * whose file no longer reads the name all fail. Moving a file off the list is
 * part of migrating it.
 *
 * The walk reads identifiers by name with no type checker. The name is unique,
 * and an alias has to spell it where it is taken (`const s =
 * cmd.dangerouslySendWithoutInput`, a destructure, an element access), so a
 * syntax walk sees every route to it.
 */

const NAME = "dangerouslySendWithoutInput";

interface Entry {
  reads: number;
  why: string;
}

const SEND_WITHOUT_INPUT: Record<string, Entry> = {
  "mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/index.tsx": {
    reads: 4,
    why: "robotics controls, awaiting a kit input command",
  },
  "mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/index.tsx": {
    reads: 6,
    why: "rotor steppers and brake, awaiting a kit input command",
  },
  "mod/sitrep-sdk/src/spine/use-body-states.ts": {
    reads: 3,
    why: "solver query, no control",
  },
  "packages/app/src/alarms/GameAlarmRows.tsx": {
    reads: 1,
    why: "alarm delete control, awaiting a kit input command",
  },
  "packages/app/src/analytics/ModLogForwarder.tsx": {
    reads: 2,
    why: "background log poll, no press",
  },
  "packages/app/src/logs/GithubIssueForm.tsx": {
    reads: 1,
    why: "log fetch while composing a report, no press",
  },
  "packages/app/src/settings/GonogoSettings.tsx": {
    reads: 1,
    why: "settings save, awaiting a host command input",
  },
  "packages/app/src/settings/ModSettingsSection.tsx": {
    reads: 1,
    why: "mod setting write, awaiting a kit input command",
  },
  "packages/components/src/AstronautComplex/AstronautComplexView.tsx": {
    reads: 1,
    why: "fire from a bound key, awaiting a control press",
  },
  "packages/components/src/GroundTrack/vanillaPoiProvider.ts": {
    reads: 1,
    why: "map point action, awaiting a command on the action",
  },
  "packages/components/src/LaunchDirector/FlyVesselMenu.tsx": {
    reads: 1,
    why: "menu item, awaiting a kit input command",
  },
  "packages/components/src/LaunchDirector/InFlightPanel.tsx": {
    reads: 1,
    why: "vessel switch row, awaiting a kit input command",
  },
  "packages/components/src/LaunchDirector/PadSection.tsx": {
    reads: 1,
    why: "vessel switch button, awaiting a kit input command",
  },
  "packages/components/src/ManeuverPlanner/useNodeCommands.ts": {
    reads: 6,
    why: "node add and remove, awaiting a command set",
  },
  "packages/components/src/Navball/index.tsx": {
    reads: 1,
    why: "trim: analog, coalesced, nothing drawn",
  },
  "packages/components/src/Navball/useFlyByWire.ts": {
    reads: 4,
    why: "fly by wire arm, disarm and lease renewal, awaiting a kit input command",
  },
  "packages/components/src/Navball/useSasControls.ts": {
    reads: 1,
    why: "SAS mode from a bound key, awaiting a control press",
  },
  "packages/components/src/ShipMap/index.tsx": {
    reads: 2,
    why: "part action and bound-key command from the map, awaiting a kit input command",
  },
  "packages/components/src/TargetPicker/TargetPickerView.tsx": {
    reads: 2,
    why: "target rows, awaiting a kit input command",
  },
  "packages/components/src/TargetPicker/useClearTarget.ts": {
    reads: 1,
    why: "clear target from a bound key, awaiting a control press",
  },
  "packages/components/src/VesselCatalog/DismissEnded.tsx": {
    reads: 1,
    why: "dismiss control, awaiting a kit input command",
  },
  "packages/components/src/WarpControl/index.tsx": {
    reads: 2,
    why: "warp ladder and pause, awaiting a kit input command",
  },
  "packages/sitrep-client/src/auto-command.ts": {
    reads: 3,
    why: "timed automatic send, no press",
  },
};

/** The files that declare the name or run the stream engine, which are not callers. */
const EXEMPT = new Set([
  "mod/sitrep-sdk/src/spine/use-command.ts",
  "mod/sitrep-sdk/src/api/types.ts",
  "packages/ui-kit/src/CommandButton/commandControl.tsx",
  "mod/sitrep-sdk/src/spine/bound-command.ts",
  "mod/sitrep-sdk/src/testing/fake-command.ts",
  "packages/sitrep-client/src/use-control-stream.tsx",
]);

/** Tests, type-tests, probes and generated code, none of which ship. */
const EXCLUDED =
  /\/dist\/|\.test\.|\.spec\.|test-d|\.scan\.|\/scripts\/|__fixtures__|__generated__/;

/**
 * The file floor, held well under the live number so ordinary movement never
 * trips it and only a broken walk does.
 */
const MINIMUM_FILES = 800;

const HERE = dirname(fileURLToPath(import.meta.url));

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: HERE,
    encoding: "utf8",
  }).trim();
}

/**
 * How many times a source file names the send, counting every identifier and
 * every `["..."]` element access, and not the declaration of a member by that
 * name in a type.
 */
function readsOf(source: string, path: string): number {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let reads = 0;
  const readsName = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node) && node.text === NAME) {
      const parent = node.parent;
      const declaresMember =
        (ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) &&
        parent.name === node;
      return !declaresMember && !ts.isIndexedAccessTypeNode(parent);
    }
    return (
      ts.isStringLiteral(node) &&
      node.text === NAME &&
      ts.isElementAccessExpression(node.parent)
    );
  };
  const visit = (node: ts.Node): void => {
    if (readsName(node)) reads++;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return reads;
}

/**
 * The failures for a set of counts against a list: a file above its count, a
 * file not on the list, and an entry that no longer reads the name or reads it
 * fewer times than it records.
 */
function problemsOf(
  counts: Map<string, number>,
  list: Record<string, Entry>,
): string[] {
  const out: string[] = [];
  for (const [file, reads] of [...counts].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const entry = list[file];
    if (!entry) {
      out.push(`${file}: ${reads} read(s) of ${NAME}, not on the list`);
      continue;
    }
    if (reads > entry.reads) {
      out.push(`${file}: ${reads} reads, the list allows ${entry.reads}`);
    }
  }
  for (const [file, entry] of Object.entries(list).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const reads = counts.get(file) ?? 0;
    if (reads === 0) {
      out.push(`${file}: stale, it no longer reads ${NAME}; remove the entry`);
      continue;
    }
    if (reads < entry.reads) {
      out.push(
        `${file}: stale, it reads ${NAME} ${reads} time(s) and the list says ${entry.reads}; lower the entry`,
      );
    }
  }
  return out;
}

function scanRoots(root: string): string[] {
  return [
    ...SCANNED_PACKAGE_ROOTS,
    ...UNSCANNED_PACKAGE_ROOTS.map((r) => r.path),
    "mod/sitrep-sdk/src",
    ...modClientRoots(root),
  ];
}

interface Walk {
  perRoot: Map<string, number>;
  filesWalked: number;
  counts: Map<string, number>;
}

function walk(root: string): Walk {
  const perRoot = new Map<string, number>();
  const counts = new Map<string, number>();
  let filesWalked = 0;
  for (const rel of scanRoots(root)) {
    const listed = execFileSync("git", ["ls-files", rel], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f) && !EXCLUDED.test(f));
    perRoot.set(rel, listed.length);
    for (const file of listed) {
      filesWalked++;
      if (EXEMPT.has(file)) continue;
      const source = readFileSync(join(root, file), "utf8");
      if (!source.includes(NAME)) continue;
      const reads = readsOf(source, file);
      if (reads > 0) counts.set(file, reads);
    }
  }
  return { perRoot, filesWalked, counts };
}

const root = repoRoot();
const walked = walk(root);

describe("styleguide-command-send", () => {
  it("every send without a kit input is on the list, at its count", () => {
    expect(problemsOf(walked.counts, SEND_WITHOUT_INPUT)).toEqual([]);
  });

  it("every entry says why", () => {
    for (const [file, entry] of Object.entries(SEND_WITHOUT_INPUT)) {
      expect(entry.why.trim().length, file).toBeGreaterThan(0);
    }
  });

  it("walks the package roots and every tracked Uplink client root, none empty", () => {
    expect(modClientRoots(root)).toEqual(trackedModClientRoots(root));
    expect([...walked.perRoot.keys()].sort()).toEqual(scanRoots(root).sort());
    for (const [rel, count] of walked.perRoot) {
      expect(count, `${rel} yielded no source files`).toBeGreaterThan(0);
    }
  });

  it("walks enough files to be a real walk", () => {
    expect(walked.filesWalked).toBeGreaterThanOrEqual(MINIMUM_FILES);
  });

  describe("sees what it exists to see (BLIND otherwise)", () => {
    const plants: Record<string, string> = {
      onClick: `export const W = () => <button onClick={() => void cmd.${NAME}({})}>x</button>;`,
      destructure: `const { ${NAME} } = useCommand("a"); ${NAME}({});`,
      alias: `const s = cmd.${NAME}; s({});`,
      "element access": `cmd["${NAME}"]({});`,
    };
    for (const [name, source] of Object.entries(plants)) {
      it(`counts a ${name} read`, () => {
        expect(readsOf(source, "plant.tsx")).toBeGreaterThan(0);
      });
    }

    it("does not count the declaration of the member in a type", () => {
      expect(
        readsOf(
          `interface H { ${NAME}(args?: unknown): Promise<void>; }\ntype T = H["${NAME}"];`,
          "plant.ts",
        ),
      ).toBe(0);
    });

    it("fails a file above its count, a file not on the list and a stale entry", () => {
      const list = { "a.ts": { reads: 1, why: "x" } };
      expect(problemsOf(new Map([["a.ts", 2]]), list)).toHaveLength(1);
      expect(problemsOf(new Map([["b.ts", 1]]), list)).toHaveLength(2);
      expect(problemsOf(new Map(), list)).toHaveLength(1);
      expect(problemsOf(new Map([["a.ts", 1]]), list)).toEqual([]);
    });
  });
});
