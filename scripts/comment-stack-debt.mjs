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

// esbuild is a dependency of `packages/core`, not of the workspace root, so it resolves from the scan's own directory rather than from this script's.
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

/**
 * A number already committed in the allowlist, or `fallback` when the file or
 * the key does not exist yet, which is the seeding run.
 */
function readPrevious(key, fallback) {
  try {
    const found = readFileSync(outPath, "utf8").match(
      new RegExp(`${key}\\s*[:=]\\s*(\\d+)`),
    );
    return found ? Number(found[1]) : fallback;
  } catch {
    return fallback;
  }
}

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
/*
 * The walked-file floor sits well below the census so ordinary churn never
 * touches it and only a broken enumeration does, and it is NEVER LOWERED: the
 * gate's own shrink-only test refuses a lowered floor.
 */
const filesFloor = Math.max(
  Math.floor(result.scanned * 0.5),
  readPrevious("files", 0),
);

/*
 * Carried through a regeneration rather than recomputed: bumping it is a
 * deliberate declaration that the matcher widened, and the gate checks the
 * claim by re-running the previous matcher over the current tree.
 */
const matcherRevision = readPrevious("MATCHER_REVISION", 1);

const header = `/**
 * Which matcher the numbers in this file were measured with.
 *
 * Every number below is a measurement, and a measurement means nothing without
 * the instrument that took it. Widening the matcher is the one change that
 * legitimately RAISES a shrink-only number, and a bare shrink-only check cannot
 * tell that from somebody laundering stacks they just wrote. So the revision is
 * the declaration: bump it in the same commit as the matcher change and the
 * ratchet re-seeds, leave it alone and every number is shrink-only as before.
 *
 * It is not an escape hatch, because a bump is not taken on trust. The ratchet
 * loads \`comment-stacks.scan.ts\` AS IT STOOD at the base revision, runs that
 * older matcher over the CURRENT tree, and requires the older numbers to still
 * hold. A re-seed therefore proves that everything newly counted is something
 * the old matcher could not see. Same mechanism as
 * \`banner-comments.allowlist.ts\`.
 *
 * 1: a three-line floor, and a run broken only by a non-comment line.
 * 2: a two-line floor, and a divider or an empty comment line ends a run.
 */
export const MATCHER_REVISION = ${matcherRevision};

/**
 * Files carrying a single-sentence \`//\` comment stack, with how many each has.
 *
 * SHRINK-ONLY. Entries may be lowered or removed, never added or raised. A new
 * entry means new code just created the violation, which is the thing the gate
 * exists to stop; fix the comment instead.
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
 * It counts files WALKED, and only that. What the scan FOUND is the debt, which
 * falls as it is paid, so a floor on it would fail the gate for the one outcome
 * it exists to produce; the census is printed beside the verdict instead.
 */
export const SCAN_FLOORS = {
  files: ${filesFloor},
} as const;
`;

writeFileSync(outPath, header + body + footer);
console.info(`\nwrote ${outPath}`);
console.info(
  `floor: ${filesFloor} files walked, matcher revision ${matcherRevision}`,
);
