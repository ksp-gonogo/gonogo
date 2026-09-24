#!/usr/bin/env node
/**
 * Regenerates `packages/core/src/unknown-cast.debt.ts` from the live tree.
 *
 *   node scripts/unknown-cast-debt.mjs                          census only
 *   node scripts/unknown-cast-debt.mjs --update --only <substr> the files you narrowed
 *   node scripts/unknown-cast-debt.mjs --update --all           seed or reseed the lot
 *
 * Run `--update` in the same commit as the narrows you wrote, so the list keeps
 * telling the truth about what is left. It cannot launder a new assertion in:
 * the gate grades the file against the ratchet base ref and fails on any key
 * added or any count raised, so a regeneration that grew is a regeneration that
 * goes red.
 *
 * ## `--update` requires a scope
 *
 * The floors at the foot of the list are derived from what the walk COVERS, so
 * they move whenever files are committed anywhere in the tree, narrows or not. A
 * full rewrite therefore lands those unrelated moves in the same diff as the one
 * key you meant to record, and a reader cannot tell which is which. That has
 * already been misread once as the floors depending on the checkout.
 *
 * So `--only` records keys and leaves every floor exactly as it found it, and
 * `--all` is the deliberate spelling for reseeding the floors too. An unscoped
 * `--update` is refused before anything is measured.
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

const args = process.argv.slice(2);
const update = args.includes("--update");
const onlyAt = args.indexOf("--only");
const only = onlyAt === -1 ? null : args[onlyAt + 1];
const all = args.includes("--all");

if (update && only !== null && all) {
  console.error("--only and --all are alternatives; pass one.");
  process.exit(1);
}
if (update && only !== null && (only === undefined || only.startsWith("--"))) {
  console.error("--only needs a path substring, e.g. --only packages/ui/src.");
  process.exit(1);
}
if (update && only === null && !all) {
  console.error(
    "Refusing an unscoped --update. The floors are derived from what the walk " +
      "covers, so a full rewrite lands every unrelated commit's movement in the " +
      "same diff as the key you meant to record:\n" +
      "  --update --only <substring>   the files you narrowed, floors untouched\n" +
      "  --update --all                seed or reseed the lot",
  );
  process.exit(1);
}

// esbuild and typescript are dependencies of `packages/core`, not of the
// workspace root, so both resolve from the scan's own directory.
const scanRequire = createRequire(scanPath);
const { transformSync } = scanRequire("esbuild");

/** A TypeScript module's exports, without a build step or a loader hook. */
function evaluateTs(path) {
  const js = transformSync(readFileSync(path, "utf8"), {
    loader: "ts",
    format: "cjs",
  }).code;
  const module_ = { exports: {} };
  new Function("module", "exports", "require", js)(
    module_,
    module_.exports,
    scanRequire,
  );
  return module_.exports;
}

const { scanUnknownCasts } = evaluateTs(scanPath);

/**
 * The list as it stands, read the same way the scan is. `--only` writes a
 * MERGE of this with the fresh census, so the floors and the keys outside the
 * scope have to come from somewhere, and parsing generated TypeScript with a
 * regex would be a second reader of a format only this script writes.
 */
const existing = only === null ? null : evaluateTs(outPath);

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

if (!update) {
  console.log(
    "\nCensus only. Pass --update --only <substring>, or --update --all.",
  );
  process.exit(0);
}

const sorted = (counts) =>
  Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  );

/** The key an erasure point is recorded under: its file and its named place. */
const pointOf = (site) => `${site.file} :: ${site.within}`;

/** Per-point counts for one predicate, in path order. */
function tally(predicate) {
  const out = {};
  for (const site of sites) {
    if (!predicate(site)) continue;
    out[pointOf(site)] = (out[pointOf(site)] ?? 0) + 1;
  }
  return sorted(out);
}

/**
 * The fresh census for the files in scope, laid over the recorded list.
 *
 * A file in scope takes its measured count, and drops out when it no longer
 * has one, which is what recording a narrow means. A file outside keeps
 * whatever the list already said, because this run was not asked about it.
 */
function scopedTo(previous, fresh) {
  if (only === null) return fresh;
  const merged = {};
  for (const [file, count] of Object.entries(previous)) {
    if (!file.includes(only)) merged[file] = count;
  }
  for (const [file, count] of Object.entries(fresh)) {
    if (file.includes(only)) merged[file] = count;
  }
  return sorted(merged);
}

/**
 * A key as biome prints it: double-quoted, unless it holds a double quote and
 * no single one, which a test's title point does.
 */
const quote = (s) =>
  s.includes('"') && !s.includes("'") && !s.includes("\\")
    ? `'${s}'`
    : JSON.stringify(s);

/**
 * The debt for one record, emitted grouped by root with a COUNTED header per
 * group, never a hand-written one: an entry's "why" is the group it sits in
 * plus the categories in the module header, and a generated sentence of prose
 * would be the one part of this file nobody could check.
 *
 * Two sources meet in that header line. The leading total is the sum of the
 * entries printed under it, so it describes the LIST; the rest describes the
 * TREE this run walked. They agree whenever the list is current, and after a
 * `--only` run they can differ by whatever nobody has recorded yet, which is
 * the honest reading of a scoped update.
 */
function emit(name, counts, note) {
  const lines = [note, `export const ${name}: Record<string, number> = {`];
  const emitted = new Set();
  for (const scan of scans) {
    const entries = Object.entries(counts).filter(([file]) =>
      file.startsWith(`${scan.root}/`),
    );
    if (entries.length === 0) continue;
    const total = entries.reduce((n, [, v]) => n + v, 0);
    const files = new Set(entries.map(([key]) => key.split(" :: ")[0])).size;
    const rootSites = scan.sites.filter((s) =>
      name === "DOUBLE_ASSERTION_DEBT" ? s.double : true,
    );
    lines.push(
      `  // ${scan.root}: ${total} at ${entries.length} points in ${files} files ` +
        `(${rootSites.filter((s) => s.kind === "any").length} out of \`any\`, ` +
        `${rootSites.filter((s) => /\.test\.tsx?$/.test(s.file)).length} in tests), ` +
        `walked ${scan.files} files`,
    );
    for (const [file, count] of entries) {
      lines.push(`  ${quote(file)}: ${count},`);
      emitted.add(file);
    }
  }
  const dropped = Object.keys(counts).filter((file) => !emitted.has(file));
  if (dropped.length > 0) {
    // A key under no scanned root is written nowhere, and the list comes out
    // shorter with nothing saying so, which reads as debt paid off.
    console.error(
      `${name} holds ${dropped.length} entries under no root the scan walks, ` +
        `so emitting would silently drop them:\n  ${dropped.join("\n  ")}\n\n` +
        `If those roots are gone for good, --update --all rewrites the list ` +
        `without them.`,
    );
    process.exit(1);
  }
  lines.push("};");
  return lines.join("\n");
}

const totalFiles = scans.reduce((n, s) => n + s.files, 0);
const totalAssertions = scans.reduce((n, s) => n + s.assertions, 0);

/**
 * The floors, measured only under `--all`.
 *
 * These are the whole reason `--update` asks for a scope. They are derived from
 * what the walk COVERS, not from the debt, so every commit anywhere moves them a
 * little and none of that movement has anything to do with the narrow being
 * recorded. Carrying them through untouched is what makes a `--only` diff read
 * as exactly the keys it changed.
 *
 * `--all` re-derives them, and that is the direction to be careful in: the gate
 * checks them with `>=`, so a smaller number is a LOOSER floor, and a reseed
 * taken over a tree that has lost files writes one. It is the deliberate
 * spelling for that reason.
 */
const scanFloors = all
  ? {
      roots: scans.length,
      files: Math.floor(totalFiles * 0.9),
      assertions: Math.floor(totalAssertions * 0.9),
    }
  : existing.SCAN_FLOORS;

const rootFileFloors = all
  ? Object.fromEntries(
      scans.map((s) => [s.root, Math.max(1, Math.floor(s.files * 0.8))]),
    )
  : existing.ROOT_FILE_FLOORS;

const header = readFileSync(
  join(root, "scripts/unknown-cast-debt.header.txt"),
  "utf8",
)
  .replace(/__TOTAL__/g, String(sites.length))
  .replace(/__DOUBLES__/g, String(doubles.length))
  .replace(/__ANY__/g, String(sites.filter((s) => s.kind === "any").length))
  .replace(/__TESTS__/g, String(inTests.length))
  .replace(/__FILES__/g, String(new Set(sites.map((s) => s.file)).size))
  .replace(
    /__POINTS__/g,
    String(new Set(sites.map((s) => `${s.file} :: ${s.within}`)).size),
  );

const body = [
  header.trimEnd(),
  "",
  emit(
    "UNKNOWN_CAST_DEBT",
    scopedTo(
      existing?.UNKNOWN_CAST_DEBT ?? {},
      tally(() => true),
    ),
    [
      "/**",
      " * Every named place carrying an assertion out of `unknown` or `any`, with",
      " * how many.",
      " *",
      " * SHRINK-ONLY: an entry may be lowered or deleted, never added or raised.",
      " * Regenerate with `node scripts/unknown-cast-debt.mjs --update --only",
      " * <substring>` in the same commit as the narrow you wrote.",
      " */",
    ].join("\n"),
  ),
  "",
  emit(
    "DOUBLE_ASSERTION_DEBT",
    scopedTo(
      existing?.DOUBLE_ASSERTION_DEBT ?? {},
      tally((s) => s.double),
    ),
    [
      "/**",
      " * The `x as unknown as T` subset, held to its OWN ceiling.",
      " *",
      " * Two lists rather than one because a place with headroom under the count",
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
    `  roots: ${scanFloors.roots},`,
    `  files: ${scanFloors.files},`,
    `  assertions: ${scanFloors.assertions},`,
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
    ...Object.entries(rootFileFloors).map(
      ([rootPath, floor]) => `  ${quote(rootPath)}: ${floor},`,
    ),
    "};",
  ].join("\n"),
  "",
].join("\n");

writeFileSync(outPath, body);
console.log(`\nWrote ${outPath}`);
