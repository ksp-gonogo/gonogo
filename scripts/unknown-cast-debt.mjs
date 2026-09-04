#!/usr/bin/env node
/**
 * Regenerates `packages/core/src/unknown-cast.debt.ts` from the live tree.
 *
 *   node scripts/unknown-cast-debt.mjs            # census only, changes nothing
 *   node scripts/unknown-cast-debt.mjs --update   # rewrite the debt list
 *
 * Run `--update` in the same commit as the narrows you wrote, so the list keeps
 * telling the truth about what is left. It cannot launder a new assertion in:
 * the gate grades the file against the ratchet base ref and fails on any key
 * added or any count raised, so a regeneration that grew is a regeneration that
 * goes red.
 *
 * IT NEEDS A BUILT TREE. The scan asks the compiler for the type of every
 * asserted expression, and an unresolved workspace import makes that type the
 * ERROR type. The scan counts those separately and this script refuses to write
 * a list while any exist, because a census taken through a half-resolved
 * program is a census of the build, not of the code. `pnpm build` first.
 *
 * It reads the SAME scan the gate reads, by transpiling `unknown-cast.scan.ts`
 * rather than re-implementing the rule. A generator holding its own copy drifts,
 * and then the list it writes is the list the gate rejects.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const scanPath = join(root, "packages/core/src/unknown-cast.scan.ts");
const outPath = join(root, "packages/core/src/unknown-cast.debt.ts");

// esbuild and typescript are dependencies of `packages/core`, not of the
// workspace root, so both resolve from the scan's own directory.
const scanRequire = createRequire(scanPath);
const { transformSync } = scanRequire("esbuild");

const js = transformSync(readFileSync(scanPath, "utf8"), {
  loader: "ts",
  format: "cjs",
}).code;
const module_ = { exports: {} };
new Function("module", "exports", "require", js)(
  module_,
  module_.exports,
  scanRequire,
);
const { scanUnknownCasts } = module_.exports;

const scans = scanUnknownCasts(root);

const errorTyped = scans.filter((s) => s.errorTyped > 0);
const unresolved = scans.filter((s) => s.unresolvedImports.length > 0);
if (errorTyped.length > 0 || unresolved.length > 0) {
  console.error(
    "This tree does not fully resolve, so the census would be wrong:\n" +
      errorTyped
        .map((s) => `  ${s.root}: ${s.errorTyped} error-typed assertions`)
        .join("\n") +
      unresolved
        .map(
          (s) =>
            `  ${s.root}: ${s.unresolvedImports.length} unresolved imports ` +
            `(first: ${s.unresolvedImports[0]})`,
        )
        .join("\n") +
      "\n\nRun `pnpm build` and try again.",
  );
  process.exit(1);
}

const sites = scans.flatMap((s) => s.sites);
const doubles = sites.filter((s) => s.double);
const inTests = sites.filter((s) => /\.test\.tsx?$/.test(s.file));

console.log(
  `${sites.length} assertions out of unknown/any across ${scans.length} roots, ` +
    `in ${new Set(sites.map((s) => s.file)).size} files.\n` +
    `  ${doubles.length} are \`as unknown as\`\n` +
    `  ${sites.filter((s) => s.kind === "any").length} are out of \`any\`\n` +
    `  ${inTests.length} are in test files\n` +
    `  ${scans.reduce((n, s) => n + s.files, 0)} files walked, ` +
    `${scans.reduce((n, s) => n + s.assertions, 0)} non-const assertions seen`,
);

for (const s of scans) {
  console.log(
    `  ${s.root}: ${s.sites.length} (${s.sites.filter((x) => x.double).length} double) in ${s.files} files`,
  );
}

if (!process.argv.includes("--update")) {
  console.log("\nCensus only. Pass --update to rewrite the debt list.");
  process.exit(0);
}

/** Per-file counts for one predicate, in path order. */
function tally(predicate) {
  const out = {};
  for (const site of sites) {
    if (!predicate(site)) continue;
    out[site.file] = (out[site.file] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => a.localeCompare(b)),
  );
}

const quote = (s) => JSON.stringify(s);

/**
 * The debt for one record, emitted grouped by root with a MEASURED header per
 * group. The facts in those headers are counted, never written by hand: an
 * entry's "why" is the group it sits in plus the categories in the module
 * header, and a generated sentence of prose would be the one part of this file
 * nobody could check.
 */
function emit(name, counts, note) {
  const lines = [note, `export const ${name}: Record<string, number> = {`];
  for (const scan of scans) {
    const entries = Object.entries(counts).filter(([file]) =>
      file.startsWith(`${scan.root}/`),
    );
    if (entries.length === 0) continue;
    const total = entries.reduce((n, [, v]) => n + v, 0);
    const rootSites = scan.sites.filter((s) =>
      name === "DOUBLE_ASSERTION_DEBT" ? s.double : true,
    );
    lines.push(
      `  // ${scan.root}: ${total} in ${entries.length} files ` +
        `(${rootSites.filter((s) => s.kind === "any").length} out of \`any\`, ` +
        `${rootSites.filter((s) => /\.test\.tsx?$/.test(s.file)).length} in tests), ` +
        `walked ${scan.files} files`,
    );
    for (const [file, count] of entries)
      lines.push(`  ${quote(file)}: ${count},`);
  }
  lines.push("};");
  return lines.join("\n");
}

const totalFiles = scans.reduce((n, s) => n + s.files, 0);
const totalAssertions = scans.reduce((n, s) => n + s.assertions, 0);

const header = readFileSync(
  join(root, "scripts/unknown-cast-debt.header.txt"),
  "utf8",
)
  .replace(/__TOTAL__/g, String(sites.length))
  .replace(/__DOUBLES__/g, String(doubles.length))
  .replace(/__ANY__/g, String(sites.filter((s) => s.kind === "any").length))
  .replace(/__TESTS__/g, String(inTests.length))
  .replace(/__FILES__/g, String(new Set(sites.map((s) => s.file)).size));

const body = [
  header.trimEnd(),
  "",
  emit(
    "UNKNOWN_CAST_DEBT",
    tally(() => true),
    [
      "/**",
      " * Every file carrying an assertion out of `unknown` or `any`, with how many.",
      " *",
      " * SHRINK-ONLY: an entry may be lowered or deleted, never added or raised.",
      " * Regenerate with `node scripts/unknown-cast-debt.mjs --update` in the same",
      " * commit as the narrow you wrote.",
      " */",
    ].join("\n"),
  ),
  "",
  emit(
    "DOUBLE_ASSERTION_DEBT",
    tally((s) => s.double),
    [
      "/**",
      " * The `x as unknown as T` subset, held to its OWN ceiling.",
      " *",
      " * Two lists rather than one because a file with headroom under the count",
      " * above must still not gain a double. A single assertion out of `unknown` is",
      " * often a boundary someone has not got to yet; a double is the shape you",
      " * reach for after the compiler has already refused the conversion once, and",
      " * refusing it is the compiler being right.",
      " */",
    ].join("\n"),
  ),
  "",
  [
    "/**",
    " * The instrument, floored on what the walk COVERS rather than on what it finds.",
    " *",
    " * Every other assertion in the gate is `expect(offenders).toEqual([])`, and a",
    " * walk that lost its roots satisfies all of them: a moved path, a tsconfig that",
    " * stopped parsing or a program built over nothing each look exactly like a clean",
    " * tree. None of these count the debt, on purpose. The debt has a real zero to aim",
    " * at, and a floor under it would be one the work has to walk through.",
    " *",
    " * `assertions` counts EVERY non-`const` assertion, offending or not, so it holds",
    " * steady as the debt falls and still fails if the walk stops seeing assertions.",
    " */",
    "export const SCAN_FLOORS = {",
    `  roots: ${scans.length},`,
    `  files: ${Math.floor(totalFiles * 0.9)},`,
    `  assertions: ${Math.floor(totalAssertions * 0.9)},`,
    "} as const;",
  ].join("\n"),
  "",
  [
    "/**",
    " * Per-root file floors, so one big root cannot cover for another that went",
    " * empty. A whole-tree total was the first shape and it hid exactly that: with",
    " * `packages/components` at 652 files, an Uplink client dropping to zero moves",
    " * the total by 2%.",
    " *",
    " * Seeded at 80% of what each root walked, which absorbs ordinary churn and not",
    " * a root that collapsed.",
    " */",
    "export const ROOT_FILE_FLOORS: Record<string, number> = {",
    ...scans.map(
      (s) => `  ${quote(s.root)}: ${Math.max(1, Math.floor(s.files * 0.8))},`,
    ),
    "};",
  ].join("\n"),
  "",
].join("\n");

writeFileSync(outPath, body);
console.log(`\nWrote ${outPath}`);
