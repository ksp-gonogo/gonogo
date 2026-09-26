#!/usr/bin/env node
/**
 * Regenerates `packages/core/src/punctuation-dashes.allowlist.ts` from the live
 * tree.
 *
 * Run it after clearing dashes out of a file, so the debt list keeps telling the
 * truth about what is left:
 *
 *   node scripts/punctuation-dash-debt.mjs --update
 *
 * Without `--update` it only prints the census, which is the safe thing to run
 * when you want to know where you stand.
 *
 * It reads the SAME scan the gate reads, by transpiling
 * `punctuation-dashes.scan.ts` rather than re-implementing the character set. A
 * generator with its own copy of the rule drifts from the gate, and then the
 * list it writes is the list the gate rejects.
 *
 * The gate refuses a debt list that GREW, so a bare `--update` cannot launder a
 * new dash into the tree: the shrink-only check compares against the ratchet
 * base ref and fails on any added or raised entry.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const scanPath = join(root, "packages/core/src/punctuation-dashes.scan.ts");
const outPath = join(root, "packages/core/src/punctuation-dashes.allowlist.ts");

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

const result = module_.exports.scanPunctuationDashes();
const total = [...result.counts.values()].reduce((a, b) => a + b, 0);
console.info(
  `${result.counts.size} files carry a forbidden dash, ${total} occurrences`,
);

const byCodepoint = new Map();
for (const hits of result.hits.values()) {
  for (const h of hits) {
    byCodepoint.set(h.codepoint, (byCodepoint.get(h.codepoint) ?? 0) + 1);
  }
}
console.info("\nby codepoint:");
for (const [cp, n] of [...byCodepoint.entries()].sort((a, b) => b[1] - a[1])) {
  console.info(`  ${cp}  ${n}`);
}

if (!process.argv.includes("--update")) {
  console.info("\nworst files:");
  for (const [file, n] of [...result.counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)) {
    console.info(`  ${String(n).padStart(3)}  ${file}`);
  }
  console.info("\nRe-run with --update to write the allowlist.");
  process.exit(0);
}

// The design system's own interval separator is a sanctioned definition site, graded by count in the gate rather than recorded as debt.
const entries = [...result.counts.entries()]
  .filter(([file]) => file !== module_.exports.SANCTIONED_FILE)
  .sort(([a], [b]) => (a < b ? -1 : 1));

const header = `/**
 * Files carrying a forbidden punctuation dash, with how many each has.
 *
 * SHRINK-ONLY. Entries may be lowered or removed, never added or raised. A new
 * entry means new code just wrote the character, which is the thing the gate
 * exists to stop; use ordinary punctuation instead.
 *
 * Most of what is here is a NUMERIC RANGE rather than prose punctuation
 * (\`0-100\`, \`30-60 s\`, \`49160-49170\`). It is still the wrong character: an
 * ASCII hyphen reads identically in a monospace editor, survives every
 * encoding, and does not need this list.
 *
 * Regenerate after a cleanup with:
 *
 *   node scripts/punctuation-dash-debt.mjs --update
 *
 * See \`styleguide-punctuation-dashes.test.ts\` for what the gate does with these
 * numbers and \`punctuation-dashes.scan.ts\` for which characters are forbidden
 * and which two are deliberately not.
 */
export const PUNCTUATION_DASH_DEBT: Record<string, number> = {
`;

const body = entries
  .map(([file, n]) => `  ${JSON.stringify(file)}: ${n},`)
  .join("\n");

writeFileSync(outPath, `${header}${body}\n};\n`);
console.info(`\nwrote ${outPath}`);
