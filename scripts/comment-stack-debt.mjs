#!/usr/bin/env node
/**
 * Regenerates `packages/core/src/comment-stacks.allowlist.ts` from the live tree.
 *
 * Run it after clearing stacks out of a file, so the debt list keeps telling the
 * truth about what is left:
 *
 *   node scripts/comment-stack-debt.mjs --update
 *
 * Without `--update` it only prints the census, which is the safe thing to run
 * when you want to know where you stand.
 *
 * It reads the SAME scan the gate reads, by transpiling `comment-stacks.scan.ts`
 * rather than re-implementing the matcher. A generator with its own copy of the
 * rule drifts from the gate, and then the list it writes is the list the gate
 * rejects.
 *
 * The gate refuses a debt list that GREW, so a bare `--update` cannot be used to
 * launder a new violation into the tree: the shrink-only check compares against
 * the ratchet base ref and fails on any added or raised entry.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const scanPath = join(root, "packages/core/src/comment-stacks.scan.ts");
const outPath = join(root, "packages/core/src/comment-stacks.allowlist.ts");

// esbuild is a dependency of `packages/core`, not of the workspace root, so it
// resolves from the scan's own directory rather than from this script's.
const { transformSync } = createRequire(scanPath)("esbuild");

const js = transformSync(readFileSync(scanPath, "utf8"), {
  loader: "ts",
  format: "cjs",
}).code;
const module_ = { exports: {} };
new Function("module", "exports", "require", js)(
  module_,
  module_.exports,
  createRequire(scanPath),
);

const result = module_.exports.scanCommentStacks();
const total = [...result.counts.values()].reduce((a, b) => a + b, 0);
const census = `scanned ${result.scanned} files (${result.generated} generated skipped), ${result.counts.size} carry a single-sentence stack, ${total} stacks`;
console.info(census);

if (!process.argv.includes("--update")) {
  const worst = [...result.counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  console.info("\nworst files:");
  for (const [file, n] of worst) {
    console.info(`  ${String(n).padStart(3)}  ${file}`);
  }
  console.info("\nRe-run with --update to write the allowlist.");
  process.exit(0);
}

const entries = [...result.counts.entries()].sort(([a], [b]) =>
  a < b ? -1 : 1,
);
// Floors sit well below the seeded census so ordinary churn never touches them
// and only a broken enumeration does.
const floors = {
  files: Math.floor(result.scanned * 0.5),
  filesWithStack: Math.floor(result.counts.size * 0.5),
  stacks: Math.floor(total * 0.5),
};

const header = `/**
 * Files carrying a single-sentence \`//\` comment stack, with how many each has.
 *
 * SHRINK-ONLY. Entries may be lowered or removed, never added or raised. A new
 * entry means new code just created the violation, which is the thing the gate
 * exists to stop; fix the comment instead.
 *
 * Seeded from the tree as it stood when the gate landed. The population is large
 * because nothing enforced the rule until now, not because the rule is new: it
 * has been in CLAUDE.md throughout. Starting at zero was never available.
 *
 * Regenerate after a cleanup with:
 *
 *   node scripts/comment-stack-debt.mjs --update
 *
 * See \`styleguide-comment-stacks.test.ts\` for what counts as a violation and
 * \`comment-stacks.scan.ts\` for the matcher itself.
 */
export const COMMENT_STACK_DEBT: Record<string, number> = {
`;

const body = entries
  .map(([file, n]) => `  ${JSON.stringify(file)}: ${n},`)
  .join("\n");

const footer = `
};

/**
 * The instrument check. Every other assertion in the gate is
 * \`expect(offenders).toEqual([])\`, and a scan that walks zero files satisfies
 * all of them: a wrong cwd, a renamed root or a \`git ls-files\` that errored into
 * an empty string each look exactly like a clean repo.
 *
 * Deliberately half the seeded census rather than equal to it, so ordinary churn
 * does not trip this and only a broken enumeration does.
 */
export const SCAN_FLOORS = {
  files: ${floors.files},
  filesWithStack: ${floors.filesWithStack},
  stacks: ${floors.stacks},
} as const;
`;

writeFileSync(outPath, header + body + footer);
console.info(`\nwrote ${outPath}`);
console.info(
  `floors: ${floors.files} files, ${floors.filesWithStack} with a stack, ${floors.stacks} stacks`,
);
