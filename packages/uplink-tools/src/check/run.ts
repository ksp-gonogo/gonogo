import { relative } from "node:path";
import { CheckUnableError } from "./program";
import type { ClientScan, FixableFinding, Rule } from "./types";

export interface RunOptions {
  rules: readonly Rule[];
  /** Every group `check` knows, so one with no rule can be reported as unchecked. */
  groups: readonly string[];
  clientDir: string;
  /** Builds the scan; called again after fixes so the result is the re-verified tree. */
  scan: () => ClientScan;
  fix?: boolean;
  only?: readonly string[];
  skip?: readonly string[];
  maxWarnings?: number;
  env: NodeJS.ProcessEnv;
}

export interface RunResult {
  findings: FixableFinding[];
  fixed: number;
  /** Groups asked for that had no rule to run. */
  unchecked: string[];
  typeErrors: number;
  exitCode: 0 | 1;
}

/** A CI environment, which is where a check must not heal what it is there to judge. */
export const inCi = (env: NodeJS.ProcessEnv): boolean => {
  const value = env.CI;
  return (
    value !== undefined && value !== "" && value !== "0" && value !== "false"
  );
};

function selectedGroups(
  groups: readonly string[],
  only: readonly string[] | undefined,
  skip: readonly string[] | undefined,
): string[] {
  for (const name of [...(only ?? []), ...(skip ?? [])]) {
    if (!groups.includes(name)) {
      throw new CheckUnableError(
        `"${name}" is not a group of check. The groups are ${groups.join(", ")}.`,
      );
    }
  }
  return groups.filter(
    (g) => (only === undefined || only.includes(g)) && !skip?.includes(g),
  );
}

export function runCheck(options: RunOptions): RunResult {
  const chosen = selectedGroups(options.groups, options.only, options.skip);
  const rules = options.rules.filter((rule) => chosen.includes(rule.group));
  const unchecked = chosen.filter(
    (group) => !options.rules.some((rule) => rule.group === group),
  );
  if (options.fix && inCi(options.env)) {
    throw new CheckUnableError(
      "--fix is refused when CI is set. A check that heals the tree it is judging passes on any tree; " +
        "run it without --fix to see what is wrong, and heal it on your own machine.",
    );
  }

  const evaluate = () => {
    const scan = options.scan();
    const findings = rules.flatMap((rule) =>
      rule.check({ clientDir: options.clientDir, scan }),
    );
    return { scan, findings };
  };

  let { scan, findings } = evaluate();
  let fixed = 0;
  if (options.fix) {
    const fixable = findings.filter((f) => f.fixable && f.apply);
    for (const finding of fixable) finding.apply?.();
    fixed = fixable.length;
    if (fixed > 0) ({ scan, findings } = evaluate());
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;
  const tooManyWarnings =
    options.maxWarnings !== undefined && warnings > options.maxWarnings;
  return {
    findings,
    fixed,
    unchecked,
    typeErrors: scan.typeErrors,
    exitCode: errors > 0 || tooManyWarnings ? 1 : 0,
  };
}

export function humanReport(result: RunResult, cwd: string): string {
  const lines: string[] = [];
  if (result.typeErrors > 0) {
    lines.push(
      `The client has ${result.typeErrors} type error${result.typeErrors === 1 ? "" : "s"}, which may hide reads from this scan.\n`,
    );
  }
  for (const f of result.findings) {
    lines.push(
      `${f.severity} ${f.rule}  ${relative(cwd, f.file)}:${f.line}`,
      `  ${f.message}`,
      `  ${f.fixable ? "fix" : "to fix"}: ${f.fix}`,
      "",
    );
  }
  const errors = result.findings.filter((f) => f.severity === "error").length;
  const warnings = result.findings.length - errors;
  const counts: Record<string, number> = {};
  for (const f of result.findings) {
    const group = f.rule.split("/")[0];
    counts[group] = (counts[group] ?? 0) + 1;
  }
  const byGroup = Object.entries(counts)
    .map(([group, n]) => `${group} ${n}`)
    .join(", ");
  const fixedNote = result.fixed > 0 ? ` ${result.fixed} fixed.` : "";
  lines.push(
    result.findings.length === 0
      ? `check: nothing found.${fixedNote}`
      : `check: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"} (${byGroup}).${fixedNote}`,
  );
  if (result.unchecked.length > 0) {
    lines.push(
      `Not checked, no rule is available for: ${result.unchecked.join(", ")}. This run proves less than a full one.`,
    );
  }
  return lines.join("\n");
}

export function jsonReport(result: RunResult): string {
  return JSON.stringify(
    result.findings.map(
      ({ rule, severity, file, line, message, fixable, fix }) => ({
        rule,
        severity,
        file,
        line,
        message,
        fixable,
        fix,
      }),
    ),
    null,
    2,
  );
}
