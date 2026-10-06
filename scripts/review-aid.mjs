/**
 * Prints the reading list for published doc comments, widget descriptions and
 * Uplink pages: sentences to read again, grouped by reason, with file and line.
 *
 *   pnpm review-aid [--package <substring>] [--category <name>]
 *
 * A listed sentence is a prompt to read it and judge it, never a fault.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "./temp-dir.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

const dir = makeTempDir("review-aid-");
const out = join(dir, "list.md");
try {
  execFileSync(
    "pnpm",
    [
      "--filter",
      "@ksp-gonogo/core",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.scans.config.ts",
      "src/published-review-aid.test.ts",
    ],
    {
      stdio: ["ignore", "ignore", "inherit"],
      env: {
        ...process.env,
        GONOGO_SCANS: "full",
        GONOGO_REVIEW_LIST: out,
        GONOGO_REVIEW_PACKAGE: flag("package") ?? "",
        GONOGO_REVIEW_CATEGORY: flag("category") ?? "",
      },
    },
  );
  process.stdout.write(readFileSync(out, "utf8"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
