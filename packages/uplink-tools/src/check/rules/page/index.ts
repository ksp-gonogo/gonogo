import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { findUplinkDir } from "../../../cli/bake";
import { page, pageCheckFiles } from "../../../cli/page";
import { CheckUnableError } from "../../program";
import type { CheckContext, FixableFinding, Rule } from "../../types";

/** What a page check run came to. */
export interface PageCheckRun {
  status: number | null;
  output: string;
  error?: string;
}

/** Runs the client's own page check test files read-only, the way `page` runs them with the write switch set. */
export function runPageCheck(
  clientDir: string,
  files: readonly string[],
): PageCheckRun {
  const result = spawnSync(
    "npx",
    ["vitest", "run", ...files.map((file) => relative(clientDir, file))],
    {
      cwd: clientDir,
      encoding: "utf8",
      // npx is a batch file on Windows, which only a shell can start.
      shell: process.platform === "win32",
    },
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    error: result.error?.message,
  };
}

/** The lines of a failed run that say what differs, or its first few when it names none. */
function whatDiffers(output: string): string {
  const lines = output.split("\n").map((line) => line.trim());
  const named = lines.filter((line) =>
    /does not exist|differs at line|committed:|generated:/.test(line),
  );
  return (named.length > 0 ? named : lines.filter(Boolean).slice(0, 8)).join(
    "\n  ",
  );
}

export function pageRule(run: typeof runPageCheck = runPageCheck): Rule {
  return {
    id: "page/stale",
    group: "page",
    check({ clientDir }: CheckContext): FixableFinding[] {
      const uplinkDir = findUplinkDir(clientDir);
      const files = pageCheckFiles(join(clientDir, "src"));
      if (files.length === 0) {
        if (!uplinkDir) return [];
        return [
          {
            rule: "page/no-check",
            severity: "error",
            file: join(clientDir, "src"),
            line: 1,
            message:
              "No test under src calls expectUplinkPageCurrent(), so nothing keeps the generated page current.",
            fixable: false,
            fix: "Add src/uplink-page.test.ts as the scaffold writes it: import expectUplinkPageCurrent from @ksp-gonogo/uplink-tools/page-check and call it in one test.",
          },
        ];
      }
      if (!existsSync(join(clientDir, "node_modules"))) {
        throw new CheckUnableError(
          `${clientDir} has no node_modules. The page check runs in the client's own test run, so install its dependencies first: npm install`,
        );
      }
      const result = run(clientDir, files);
      if (result.error) {
        throw new CheckUnableError(
          `could not run the client's page check: ${result.error}`,
        );
      }
      if (result.status === 0) return [];
      return [
        {
          rule: "page/stale",
          severity: "error",
          file: files[0],
          line: 1,
          message: `The page check fails, so README.md, gonogo-uplink.json or docs/widgets.json no longer describes what the client registers.\n  ${whatDiffers(result.output)}`,
          fixable: true,
          fix: "Run `uplink-tools page` and commit what it writes.",
          apply: () => {
            page(["--client", clientDir]);
          },
        },
      ];
    },
  };
}

export const pageRules: readonly Rule[] = [pageRule()];
