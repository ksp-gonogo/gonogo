import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readUplinkDeclaration } from "@ksp-gonogo/sitrep-sdk/uplink-manifest";
import { findUplinkDir } from "../../../cli/bake";
import { generate } from "../../../cli/codegen";
import type { CheckContext, FixableFinding, Rule } from "../../types";

/** Whether the .NET SDK answers on PATH, which codegen builds the contract slice with. */
export function dotnetAvailable(): boolean {
  const probe = spawnSync("dotnet", ["--version"], { stdio: "ignore" });
  return probe.error === undefined && probe.status === 0;
}

/** Runs `fn` with console output swallowed, so `--json` stays the only thing printed. */
function quietly<Result>(fn: () => Result): Result {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
}

export interface CodegenRuleOptions {
  hasDotnet?: () => boolean;
  /** What `codegen --check` does; throws when the committed files differ. */
  generate?: (uplinkDir: string, check: boolean) => void;
}

export function codegenRule(options: CodegenRuleOptions = {}): Rule {
  const hasDotnet = options.hasDotnet ?? dotnetAvailable;
  const run =
    options.generate ??
    ((uplinkDir: string, check: boolean) => {
      quietly(() => generate({ uplinkDir, check }));
    });
  return {
    id: "codegen/stale",
    group: "codegen",
    check({ clientDir }: CheckContext): FixableFinding[] {
      const uplinkDir = findUplinkDir(clientDir);
      if (!uplinkDir) return [];
      const declared = readUplinkDeclaration(clientDir)?.declared;
      if (declared?.codegen === undefined || declared.codegen === null) {
        return [];
      }
      const file = join(clientDir, "src", "__generated__");
      if (!hasDotnet()) {
        return [
          {
            rule: "codegen/skipped",
            severity: "warning",
            file,
            line: 1,
            message:
              "Skipped, the .NET SDK is not on PATH, so whether src/__generated__ matches the contract slice was not checked. This run proves less than a full one.",
            fixable: false,
            fix: "Install the .NET SDK from https://dotnet.microsoft.com/download and run check again.",
          },
        ];
      }
      try {
        run(uplinkDir, true);
        return [];
      } catch (err) {
        return [
          {
            rule: "codegen/stale",
            severity: "error",
            file,
            line: 1,
            message: err instanceof Error ? err.message : String(err),
            fixable: true,
            fix: "Run `uplink-tools codegen` and commit what it writes.",
            apply: () => run(uplinkDir, false),
          },
        ];
      }
    },
  };
}

export const codegenRules: readonly Rule[] = [codegenRule()];
