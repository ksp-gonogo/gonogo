// @vitest-environment node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  baseStrings,
  ratchetBaseRef,
  readJsonObject,
  sourceAtRatchetBase,
} from "./ratchetBaseRef";

/**
 * A built-in widget reads only the Topics its registration declares, and
 * declares only Topics it reads.
 *
 * The comparison is `uplink-tools check --only declarations` run over
 * `packages/components`: it walks each widget's component through the calls it
 * contains, names the Topics they read, and holds that against the channels,
 * optional channels and fields the registration lists. A widget that reads a
 * Topic its manifest leaves out is reported against its generated declarations
 * file, so the heal is `uplink-tools check --fix`.
 *
 * Held by `widget-reads-declared.debt.json`, a list of `<rule> <file>` entries
 * that only shrinks. `GONOGO_WIDGET_READS_UPDATE=1` rewrites it with the
 * entries that now pass removed, and never adds one.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const DEBT_PATH = "packages/core/src/widget-reads-declared.debt.json";
const COMPONENTS = join(REPO_ROOT, "packages", "components");
const GRADED_ROOT = "packages/components/src/";
const UNGRADED = ["packages/components/src/test/"];

interface Finding {
  rule: string;
  severity: string;
  file: string;
}

/** Whether a finding is an error against a widget this gate grades. */
function graded(finding: Finding, root: string): boolean {
  if (finding.severity !== "error") return false;
  const file = relative(root, finding.file);
  return (
    file.startsWith(GRADED_ROOT) &&
    !UNGRADED.some((prefix) => file.startsWith(prefix))
  );
}

const entryOf = (finding: Finding, root: string) =>
  `${finding.rule} ${relative(root, finding.file)}`;

/** The output of a process that exited with findings: check exits 1 and still reports on stdout. */
function reportOfExit(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 1 &&
    "stdout" in error &&
    typeof error.stdout === "string"
  ) {
    return error.stdout;
  }
  throw error;
}

function isFinding(value: unknown): value is Finding {
  return (
    typeof value === "object" &&
    value !== null &&
    "rule" in value &&
    typeof value.rule === "string" &&
    "severity" in value &&
    typeof value.severity === "string" &&
    "file" in value &&
    typeof value.file === "string"
  );
}

function scan(): string[] {
  let stdout: string;
  try {
    stdout = execFileSync(
      "node",
      [
        join(REPO_ROOT, "packages/uplink-tools/bin/uplink-tools.mjs"),
        "check",
        "--only",
        "declarations",
        "--json",
      ],
      { cwd: COMPONENTS, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    stdout = reportOfExit(error);
  }
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed) || !parsed.every(isFinding)) {
    throw new Error(
      "uplink-tools check --json did not print a list of findings",
    );
  }
  return [
    ...new Set(
      parsed
        .filter((f) => graded(f, REPO_ROOT))
        .map((f) => entryOf(f, REPO_ROOT)),
    ),
  ].sort();
}

const DEBT = (() => {
  const parsed = readJsonObject(join(REPO_ROOT, DEBT_PATH));
  const list = baseStrings({ debt: parsed.debt }, "debt");
  if (!list) throw new Error(`${DEBT_PATH} has no "debt" list`);
  return list;
})();
const NOW = scan();

describe("design-system: a widget reads only what its manifest declares", () => {
  it("grades the planted findings before the tree", () => {
    const at = (file: string, severity = "error") => ({
      rule: "declarations/stale",
      severity,
      file: join(REPO_ROOT, file),
    });
    expect(
      [
        graded(at("packages/components/src/CommSignal/index.tsx"), REPO_ROOT),
        graded(
          at("packages/components/src/CommSignal/index.tsx", "warning"),
          REPO_ROOT,
        ),
        graded(at("packages/components/src/test/setup.ts"), REPO_ROOT),
        graded(at("mod/sitrep-sdk/src/spine/use.ts"), REPO_ROOT),
      ],
      "BLIND: an error on a built-in widget must fail, and a warning, a test harness or a file outside the widgets must not",
    ).toEqual([true, false, false, false]);
  });

  it("finds no widget outside the debt list", () => {
    const unlisted = NOW.filter((entry) => !DEBT.includes(entry));
    expect(
      unlisted,
      `${unlisted.length} widget declaration finding(s). Heal with \`pnpm --filter @ksp-gonogo/components exec uplink-tools check --only declarations --fix\`, or read the Topic the manifest names:\n${unlisted.join("\n")}`,
    ).toEqual([]);
  });

  it("lists no entry that now passes", () => {
    if (process.env.GONOGO_WIDGET_READS_UPDATE) {
      writeFileSync(
        join(REPO_ROOT, DEBT_PATH),
        `${JSON.stringify({ debt: DEBT.filter((e) => NOW.includes(e)).sort() }, null, 2)}\n`,
      );
      return;
    }
    const stale = DEBT.filter((entry) => !NOW.includes(entry));
    expect(
      stale,
      `${stale.length} debt entr(ies) now pass. Remove them with GONOGO_WIDGET_READS_UPDATE=1:\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  it("never grows", () => {
    const at = ratchetBaseRef();
    if (!at) return;
    const source = sourceAtRatchetBase(at, DEBT_PATH);
    if (source === null) return;
    const before = baseStrings({ debt: JSON.parse(source).debt }, "debt");
    if (!before) return;
    expect(
      DEBT.length,
      `the widget declaration debt grew since ${at.ref}. Declare the read instead`,
    ).toBeLessThanOrEqual(before.length);
  });
});
