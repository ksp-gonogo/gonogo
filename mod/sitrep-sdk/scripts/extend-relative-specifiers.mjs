/**
 * Gives every relative module specifier in the emitted output its file
 * extension, so the package loads under Node's ESM resolver.
 *
 * `tsc` never rewrites a module specifier. It copies what the source wrote,
 * and the source writes `./api` because this repo's `tsconfig.base.json` sets
 * `moduleResolution: "bundler"`, which is the correct baseline for the file it
 * is: an Uplink client IS bundled, and that config is the one the SDK ships to
 * authors. It is wrong for the SDK's own emit. The package is `"type":
 * "module"`, and Node's ESM resolver does no extension search, so
 * `import "@ksp-gonogo/sitrep-sdk"` threw ERR_MODULE_NOT_FOUND on the very
 * first specifier in `dist/index.js` for every consumer that is not a bundler:
 * Node, vitest, ts-node, an Uplink author's test run.
 *
 * Measured on an extracted Uplink client: all 18 of its test files failed to
 * load before a single assertion ran.
 *
 * That shipped because nothing ever EXECUTED an import of the built package.
 * Inside the workspace the manifest points at `src`, so the app and every
 * first-party test resolve TypeScript and never read `dist` at all.
 * `scripts/uplink-extraction-probe.mjs` does read `dist`, but only ever ran
 * `tsc --noEmit`, and a typecheck is the one operation that succeeds on this:
 * TypeScript resolves `./api` happily under `bundler`. So the only instrument
 * pointed at this question answered it on the wrong axis.
 *
 * ## Why a post-emit pass rather than a bundler
 *
 * `@ksp-gonogo/ui-kit` has no such bug because tsup bundles it and emits `.js`,
 * which makes "build the SDK with tsup too" the obvious move. It is the wrong
 * one here. This package emits 168 modules behind six subpath entries, and a
 * great deal of what it does is module-level singleton state: the unit
 * registry, the topic registry, `PerfBudget`'s registry, the augment registry.
 * File-per-module ESM guarantees one instance of each. Chunked bundler output
 * guarantees it only for as long as the chunk graph happens to cooperate, and
 * `packages/ui-kit/tsup.config.ts` carries three long comments about the times
 * it did not: a chunk reachable only through one entry that never evaluated,
 * leaving a namespace whose every export was `undefined`, and two copies of a
 * React context across an externalisation boundary. This package also holds at
 * least one deliberate import cycle (`perf/PerfBudget` -> `api/index` ->
 * `api/settings/SettingsService` -> `perf/PerfBudget`, see `src/index.ts`),
 * which real ESM resolves through hoisting and a bundler resolves however its
 * chunking fell out.
 *
 * So the emit shape stays exactly as `tsc` wrote it and only the specifiers
 * change. Nothing about the module graph, the singletons or the cycles moves.
 *
 * ## Why it cannot silently do nothing
 *
 * A rewriter that fails to match is indistinguishable from one with nothing to
 * match: both print zero. Two things guard that. Every rewrite is decided by
 * RESOLVING the target against the filesystem rather than by pattern, so a
 * specifier this cannot place is a hard failure rather than a skip. And the
 * pass ends by re-parsing everything it wrote and asserting that no relative
 * specifier is left without an extension, which is the property the package
 * actually needs and is not the same claim as "n edits were made".
 *
 * The `.d.ts` files are rewritten too. Type resolution does not need it today,
 * because TypeScript maps `./api.js` and `./api` alike, but a consumer on
 * `nodenext` resolves declarations the way Node resolves modules, and leaving
 * the two halves disagreeing is how this class of bug returns.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

const DIST = new URL("../dist/", import.meta.url).pathname;

/**
 * Emitted per source module, so this many files is a build that ran. A pass
 * over an empty or absent tree reports the same "nothing to extend" as a clean
 * one.
 */
const MIN_EMITTED_FILES = 100;

/** Extensions a relative specifier may already carry and be left alone. */
const RESOLVED_EXTENSIONS = [".js", ".mjs", ".cjs", ".json", ".css", ".node"];

function emittedFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...emittedFiles(path));
    else if (/\.d\.ts$/.test(entry.name) || /\.js$/.test(entry.name))
      found.push(path);
  }
  return found;
}

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const isDirectory = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * What a specifier should become, resolved against the emitted tree.
 *
 * A `.d.ts` importer names the `.js` sibling, not the declaration: that is what
 * `tsc` itself emits under `nodenext`, and it is what a consumer's Node-style
 * declaration resolution looks for before substituting `.d.ts` in. Returns
 * `null` when the specifier already resolves and needs nothing.
 */
function resolvedSpecifier(specifier, fromFile) {
  if (!specifier.startsWith(".")) return null;
  if (RESOLVED_EXTENSIONS.some((ext) => specifier.endsWith(ext))) return null;

  const target = resolve(dirname(fromFile), specifier);
  const declaration = /\.d\.ts$/.test(fromFile);
  // A declaration file's own siblings are `.d.ts`; a `.js` file's are `.js`.
  // Either way the specifier that ships names `.js`.
  const sibling = declaration ? `${target}.d.ts` : `${target}.js`;
  const barrel = join(target, declaration ? "index.d.ts" : "index.js");

  if (isFile(sibling)) return `${specifier}.js`;
  if (isDirectory(target) && isFile(barrel)) return `${specifier}/index.js`;
  return undefined;
}

/** Every module-specifier string literal in a source file, with its span. */
function specifierNodes(sourceFile) {
  const found = [];
  const take = (node) => {
    if (node && ts.isStringLiteral(node)) found.push(node);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      take(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      take(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      take(node.arguments[0]);
    } else if (ts.isImportTypeNode(node)) {
      // `import("./x").Foo`, which is how a `.d.ts` names a type it did not
      // import by name.
      if (ts.isLiteralTypeNode(node.argument)) take(node.argument.literal);
    } else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      take(node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

let files;
try {
  files = emittedFiles(DIST);
} catch (cause) {
  console.error(
    `✖ ${DIST} could not be read, so there is nothing to extend. Run the tsc build first.`,
  );
  throw cause;
}

if (files.length < MIN_EMITTED_FILES) {
  console.error(
    `✖ BLIND: found only ${files.length} emitted file(s) under dist/, expected at least ` +
      `${MIN_EMITTED_FILES}. A pass over an empty tree reports the same "nothing to extend" as a ` +
      "clean one, so this refuses to report success.",
  );
  process.exit(1);
}

/** Rewrites one file; returns the number of specifiers changed. */
function extend(file, unresolvable) {
  const original = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    original,
    ts.ScriptTarget.Latest,
    true,
  );
  const spans = [];
  for (const node of specifierNodes(sourceFile)) {
    const replacement = resolvedSpecifier(node.text, file);
    if (replacement === null) continue;
    if (replacement === undefined) {
      unresolvable.push(`${file.slice(DIST.length)}: "${node.text}"`);
      continue;
    }
    /*
     * Reuse the quote character `tsc` chose rather than normalising it: it
     * writes `.d.ts` with single quotes and `.js` with double, and rewriting
     * that is churn in a diff someone eventually has to read. A module
     * specifier is a path, so there is nothing in it to escape, and the
     * assertion says so rather than assuming it.
     */
    const quote = original[node.getStart(sourceFile)];
    if (replacement.includes(quote) || replacement.includes("\\")) {
      unresolvable.push(
        `${file.slice(DIST.length)}: "${node.text}" cannot be requoted safely`,
      );
      continue;
    }
    spans.push({
      start: node.getStart(sourceFile),
      end: node.getEnd(),
      text: `${quote}${replacement}${quote}`,
    });
  }
  if (spans.length === 0) return 0;
  let updated = original;
  // Back to front, so an earlier rewrite cannot move a later span.
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    updated =
      updated.slice(0, span.start) + span.text + updated.slice(span.end);
  }
  writeFileSync(file, updated);
  return spans.length;
}

const unresolvable = [];
let extended = 0;
for (const file of files) extended += extend(file, unresolvable);

if (unresolvable.length > 0) {
  console.error(
    `✖ ${unresolvable.length} relative specifier(s) in dist/ name nothing on disk, so this ` +
      "cannot give them an extension and will not guess one:\n" +
      `${unresolvable
        .slice(0, 20)
        .map((entry) => `    ${entry}`)
        .join("\n")}`,
  );
  process.exit(1);
}

/*
 * The count above says how many edits were made, which is not the property the
 * package needs. This is: re-parse everything and require that no relative
 * specifier is left for Node to fail on.
 */
const remaining = [];
for (const file of emittedFiles(DIST)) {
  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const node of specifierNodes(sourceFile)) {
    if (!node.text.startsWith(".")) continue;
    if (RESOLVED_EXTENSIONS.some((ext) => node.text.endsWith(ext))) continue;
    remaining.push(`${file.slice(DIST.length)}: "${node.text}"`);
  }
}

if (remaining.length > 0) {
  console.error(
    `✖ ${remaining.length} relative specifier(s) still carry no extension after the pass, so ` +
      "Node's ESM resolver will fail on them:\n" +
      `${remaining
        .slice(0, 20)
        .map((entry) => `    ${entry}`)
        .join("\n")}`,
  );
  process.exit(1);
}

console.log(
  `extend-relative-specifiers: scanned ${files.length} emitted file(s), extended ${extended} ` +
    "relative specifier(s); none is left without one.",
);
