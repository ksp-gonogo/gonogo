// @vitest-environment node
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CODEGEN_STEPS,
  type CodegenStep,
} from "../../../scripts/run-codegen.mjs";

/**
 * `pnpm codegen`, `mod/codegen.sh` and CI's codegen check all run the one list
 * in `scripts/run-codegen.mjs`. What holds here is that every tracked file under
 * a `__generated__` directory is named as an output of one of its steps, so a
 * generator added without joining the list (or a step dropped from it) fails
 * here instead of as a stale file in CI.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

type Step = CodegenStep;

function owns(output: string, file: string): boolean {
  const pattern = output
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${pattern}${output.endsWith("/") ? "" : "$"}`).test(file);
}

/** The tracked generated files no step claims, or "BLIND" when the scan read none. */
function unowned(files: string[], steps: Step[]): string[] | "BLIND" {
  if (files.length === 0) return "BLIND";
  return files.filter(
    (file) => !steps.some((s) => s.outputs.some((o) => owns(o, file))),
  );
}

function trackedGenerated(): string[] {
  return execFileSync("git", ["ls-files", "--", "*/__generated__/*"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

describe("every generated file has a codegen step", () => {
  it("leaves no tracked __generated__ file without an owner", () => {
    expect(unowned(trackedGenerated(), CODEGEN_STEPS)).toEqual([]);
  });

  it("fails as BLIND when it reads no files", () => {
    expect(unowned([], CODEGEN_STEPS)).toBe("BLIND");
  });

  it("sees a planted file no step writes", () => {
    const planted = "mod/sitrep-sdk/src/__generated__/planted-unowned.ts";
    expect(unowned([...trackedGenerated(), planted], CODEGEN_STEPS)).toEqual([
      planted,
    ]);
  });

  it("sees a step dropped from the list", () => {
    const without = CODEGEN_STEPS.filter((s) => s.label !== "delay-roles");
    expect(unowned(trackedGenerated(), without)).toEqual([
      "mod/sitrep-sdk/src/__generated__/delay-roles.ts",
      "mod/sitrep-sdk/src/__generated__/sample-kinds.ts",
    ]);
  });
});
