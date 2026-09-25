import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every step of `ci.yml`'s `mod` job is accounted for by the push gate, and the
 * push gate accounts for nothing the job does not run.
 *
 * `scripts/mod-job-gate.sh` executes a table, `MOD_JOB_STEPS`, with one line per
 * named step of the job: run on every push, run when the push touches the mod,
 * performed in full by another step, or CI-only with the reason. A step added to
 * the job and not to the table is a check the push path cannot see, and nothing
 * about the push says so: it lands green and CI is the first to run it. So the
 * two are compared here, in the blocking `test` job and in the pre-push scans,
 * name for name and in order, since the table's order is the order the gate runs
 * in and the job's order is what makes a step's precondition hold (the reference
 * set before the compile that needs it, the pack before the probe of the pack).
 *
 * A step with a `run:` and no `name:` cannot be matched to anything, so it is an
 * error rather than a step this skips.
 */

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const CI_YML = join(ROOT, ".github/workflows/ci.yml");
const GATE = join(ROOT, "scripts/mod-job-gate.sh");

interface JobStep {
  name: string | null;
  runs: boolean;
  line: number;
}

/** The steps of `job` in a workflow file, read as text at the indentation ci.yml uses. */
function jobSteps(yaml: string, job: string): JobStep[] {
  const lines = yaml.split("\n");
  const start = lines.indexOf(`  ${job}:`);
  if (start === -1) throw new Error(`No \`${job}:\` job in the workflow`);
  const steps: JobStep[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^ {2}[A-Za-z][\w-]*:\s*$/.test(line)) break;
    const opened = /^ {6}- (.*)$/.exec(line);
    const key = opened ? opened[1] : (/^ {8}(\S.*)$/.exec(line)?.[1] ?? null);
    if (opened) steps.push({ name: null, runs: false, line: i + 1 });
    const step = steps.at(-1);
    if (!step || key === null) continue;
    const name = /^name:\s*(.+?)\s*$/.exec(key);
    if (name) step.name = name[1].replace(/^(['"])(.*)\1$/, "$2");
    if (/^run:/.test(key)) step.runs = true;
  }
  return steps;
}

interface GateStep {
  name: string;
  kind: string;
  arg: string;
}

/** `MOD_JOB_STEPS` from the gate script, one entry per line. */
function gateSteps(script: string): GateStep[] {
  const body = /^MOD_JOB_STEPS='([^']*)'$/m.exec(script);
  if (!body) throw new Error("No MOD_JOB_STEPS='...' table in the gate script");
  return body[1]
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const bar = l.indexOf("|");
      const treatment = l.slice(bar + 1);
      const colon = treatment.indexOf(":");
      return {
        name: l.slice(0, bar),
        kind: colon === -1 ? treatment : treatment.slice(0, colon),
        arg: colon === -1 ? "" : treatment.slice(colon + 1),
      };
    });
}

/** Every way the table fails to describe the job, as sentences. Empty when it does. */
function disagreements(
  job: JobStep[],
  table: GateStep[],
  script: string,
): string[] {
  const problems: string[] = [];
  for (const step of job) {
    if (step.name === null && step.runs) {
      problems.push(
        `ci.yml line ${step.line}: a \`run:\` step with no \`name:\`, which the gate's table cannot name`,
      );
    }
  }
  const jobNames = job.flatMap((s) => (s.name === null ? [] : [s.name]));
  const tableNames = table.map((s) => s.name);
  for (const name of jobNames) {
    if (!tableNames.includes(name)) {
      problems.push(
        `"${name}" is a mod-job step the gate's table does not name`,
      );
    }
  }
  for (const name of tableNames) {
    if (!jobNames.includes(name)) {
      problems.push(
        `"${name}" is in the gate's table and is not a mod-job step`,
      );
    }
  }
  const shared = jobNames.filter((n) => tableNames.includes(n));
  const tableOrder = tableNames.filter((n) => jobNames.includes(n));
  if (shared.join("\n") !== tableOrder.join("\n")) {
    problems.push(
      `the gate's table runs the steps in a different order from the job:\n  job:   ${shared.join(" / ")}\n  table: ${tableOrder.join(" / ")}`,
    );
  }
  for (const step of table) {
    switch (step.kind) {
      case "always":
      case "mod":
        if (!new RegExp(`^step_${step.arg}\\(\\) \\{`, "m").test(script)) {
          problems.push(
            `"${step.name}" runs step_${step.arg}, which the script does not define`,
          );
        }
        break;
      case "same": {
        const target = table.find((s) => s.name === step.arg);
        if (!target || (target.kind !== "always" && target.kind !== "mod")) {
          problems.push(
            `"${step.name}" is covered by "${step.arg}", which is not a step the gate runs`,
          );
        }
        break;
      }
      case "ci":
        if (step.arg.trim() === "") {
          problems.push(`"${step.name}" is CI-only with no reason given`);
        }
        break;
      default:
        problems.push(`"${step.name}" has an unknown treatment "${step.kind}"`);
    }
  }
  return problems;
}

const yaml = readFileSync(CI_YML, "utf8");
const script = readFileSync(GATE, "utf8");
const job = jobSteps(yaml, "mod");
const table = gateSteps(script);

describe("the push gate accounts for every step of ci.yml's mod job", () => {
  it("read both sides", () => {
    expect(job.map((s) => s.name)).toContain(
      "dotnet test (KSP-independent Sitrep projects)",
    );
    expect(table.map((s) => s.name)).toContain(
      "dotnet test (KSP-independent Sitrep projects)",
    );
  });

  it("the table and the job agree", () => {
    expect(disagreements(job, table, script)).toEqual([]);
  });

  describe("can see each way they come apart", () => {
    const withStep = (extra: string) =>
      yaml.replace(
        /^ {2}mod:\n {4}runs-on: .*\n {4}steps:\n/m,
        (m) => `${m}${extra}`,
      );

    it("a job step the table does not name", () => {
      const planted = jobSteps(
        withStep("      - name: A planted step\n        run: true\n\n"),
        "mod",
      );
      expect(disagreements(planted, table, script)).toEqual([
        `"A planted step" is a mod-job step the gate's table does not name`,
      ]);
    });

    it("an unnamed step that runs something", () => {
      const planted = jobSteps(withStep("      - run: true\n\n"), "mod");
      expect(disagreements(planted, table, script)).toEqual([
        expect.stringMatching(/a `run:` step with no `name:`/),
      ]);
    });

    it("a table line for a step the job no longer has", () => {
      const planted = [
        ...table,
        { name: "A departed step", kind: "ci", arg: "gone" },
      ];
      expect(disagreements(job, planted, script)).toEqual([
        `"A departed step" is in the gate's table and is not a mod-job step`,
      ]);
    });

    it("the table in a different order", () => {
      const planted = [table[1], table[0], ...table.slice(2)];
      expect(disagreements(job, planted, script)).toEqual([
        expect.stringMatching(/different order/),
      ]);
    });

    it("a step function the script does not define, and a bad cover", () => {
      const planted = table.map((s, i) =>
        i === 1
          ? { ...s, arg: "planted_missing" }
          : s.kind === "same"
            ? { ...s, arg: table[0].name }
            : s,
      );
      expect(disagreements(job, planted, script)).toEqual([
        `"${table[1].name}" runs step_planted_missing, which the script does not define`,
        expect.stringMatching(/which is not a step the gate runs/),
      ]);
    });
  });
});
