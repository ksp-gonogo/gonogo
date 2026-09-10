/**
 * Gives every deep package-subpath specifier in the emitted declarations a file
 * extension, so the kit's types resolve for a consumer on `nodenext`.
 *
 * `tsc` writes a declaration's module specifiers itself whenever the type was
 * INFERRED rather than imported by name, and it writes them for the resolver
 * the kit is built under. This repo's `tsconfig.base.json` sets
 * `moduleResolution: "bundler"`, which is right for the source, so the emit for
 * `styled.button` came out as
 *
 *     import * as x from 'styled-components/dist/types';
 *
 * Under `bundler` that resolves, because bundler mode still does an extension
 * search. Under `nodenext` it does not: the kit is `"type": "module"`, so the
 * specifier is read in ESM mode, ESM does no extension search, and
 * `styled-components@6` ships no `exports` map to redirect it. `traceResolution`
 * ends with "Module name 'styled-components/dist/types' was not resolved."
 *
 * It should be a TS2307 and it is not, because the base config an Uplink author
 * inherits sets `skipLibCheck: true`, which suppresses the error inside our
 * `.d.ts` and leaves the import binding to `any`. The 29 references to
 * `IStyledComponentBase` then take 25 exported primitives with them (`Button`,
 * `Input`, `Select`, `Card`, the whole `Field*` family), so their props are not
 * checked at all. A wrong prop on any of them compiles clean. Nothing anywhere
 * prints a word about it.
 *
 * Building the kit under `nodenext` is not the fix: `styled-components` is CJS
 * with no `exports` map, so its default export arrives as a namespace and
 * `styled.button` is a TS2339 before any of our own code is reached.
 *
 * Annotating the primitives is not the fix either. The type in the emit is
 * `IStyledComponentBase`, and that name is NOT among the ones
 * `styled-components` re-exports from its package root, so there is no
 * root-reachable spelling to annotate with that means the same thing. Even a
 * near-enough substitute would have to be written onto 25 exports by hand and
 * remembered for the twenty-sixth.
 *
 * ## Why a post-emit pass
 *
 * tsup's declaration build is a `tsc` emit fed through `rollup-plugin-dts`, and
 * neither half takes a hook that can influence the specifier: `tsc` chooses it,
 * and rollup only hoists it to the top of the bundle. The specifier is the only
 * thing wrong with the output, so the pass changes the specifier and nothing
 * else. `mod/sitrep-sdk/scripts/extend-relative-specifiers.mjs` is the same
 * move for the same reason on that package's RELATIVE specifiers; this is its
 * deep-subpath sibling.
 *
 * `dist/*.js` is left alone deliberately. esbuild resolves every specifier it
 * emits, so it never invents a deep subpath: the runtime output reaches
 * `styled-components` by its package root and nothing else.
 *
 * ## Why it cannot silently do nothing
 *
 * Nothing here decides by pattern. Every specifier is put through TypeScript's
 * own resolver twice, once forced into ESM under `nodenext` and once under
 * `bundler`, and a rewrite is accepted only when it makes the first succeed and
 * leaves the second landing on the same file. A specifier this cannot place is
 * a hard failure rather than a skip.
 *
 * The pass then re-reads what it wrote and requires that every deep subpath in
 * `dist/` resolves under `nodenext`, which is the property a consumer needs and
 * is not the same claim as "n edits were made". And because a verifier that has
 * stopped matching reports the same clean tree as a clean tree, it first plants
 * a specifier it knows to be broken and fails as BLIND if it cannot see it.
 */
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const DIST = new URL("../dist/", import.meta.url).pathname;

/**
 * The kit emits one declaration per entry point plus its shared chunks. Fewer
 * than this is a build that did not run, and a pass over an absent tree reports
 * the same "nothing to extend" as a clean one.
 */
const MIN_DECLARATION_FILES = 5;

/** Extensions a specifier may already carry and be left alone. */
const RESOLVED_EXTENSIONS = [".js", ".mjs", ".cjs", ".json", ".css", ".node"];

/** What a broken specifier is rewritten to, in the order they are tried. */
const CANDIDATE_SUFFIXES = [".js", "/index.js"];

const RESOLVER_OPTIONS = {
  nodenext: {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  },
  bundler: {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  },
};

function declarationFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...declarationFiles(path));
    else if (entry.name.endsWith(".d.ts")) found.push(path);
  }
  return found;
}

/**
 * Whether the specifier names a path INSIDE a package rather than the package
 * itself. A package root is the consumer's own resolution problem: it is a peer
 * we deliberately did not bundle, and how it resolves depends on their tree.
 * A deep subpath is ours, because we are the ones who wrote the path.
 */
function isDeepSubpath(specifier) {
  if (specifier.startsWith(".") || specifier.startsWith("#")) return false;
  if (
    specifier.startsWith("node:") ||
    ts.isExternalModuleNameRelative(specifier)
  )
    return false;
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.length > 2 : segments.length > 1;
}

/**
 * The file a specifier lands on, or `undefined` if it does not resolve.
 * `resolutionMode` is forced rather than inferred so the answer is about the
 * mode we mean to test and not about whichever `package.json` happens to sit
 * above the containing file.
 */
function resolvesTo(specifier, containingFile, mode) {
  const { resolvedModule } = ts.resolveModuleName(
    specifier,
    containingFile,
    RESOLVER_OPTIONS[mode],
    ts.sys,
    undefined,
    undefined,
    mode === "nodenext" ? ts.ModuleKind.ESNext : undefined,
  );
  return resolvedModule?.resolvedFileName;
}

/** Every module-specifier string literal in a declaration file, with its span. */
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
    } else if (ts.isImportTypeNode(node)) {
      // `import("styled-components/dist/types").Foo`, which is how a `.d.ts`
      // names a type it did not import by name.
      if (ts.isLiteralTypeNode(node.argument)) take(node.argument.literal);
    } else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      take(node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

const parse = (file) =>
  ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );

/** Deep subpaths in `file` that do not resolve under nodenext, as `file: "spec"`. */
function unresolvedIn(file) {
  const found = [];
  for (const node of specifierNodes(parse(file))) {
    if (!isDeepSubpath(node.text)) continue;
    if (resolvesTo(node.text, file, "nodenext")) continue;
    found.push(`${file.slice(DIST.length)}: "${node.text}"`);
  }
  return found;
}

let files;
try {
  files = declarationFiles(DIST);
} catch (cause) {
  console.error(
    `✖ ${DIST} could not be read, so there is nothing to extend. Run the build first.`,
  );
  throw cause;
}

if (files.length < MIN_DECLARATION_FILES) {
  console.error(
    `✖ BLIND: found only ${files.length} declaration file(s) under dist/, expected at least ` +
      `${MIN_DECLARATION_FILES}. A pass over an empty tree reports the same "nothing to extend" ` +
      "as a clean one, so this refuses to report success.",
  );
  process.exit(1);
}

/*
 * The planted violation. `styled-components/dist/types` is the specifier this
 * pass exists for, so a checker that cannot see it here has stopped being able
 * to see the thing it is guarding.
 */
const PLANT = join(DIST, "__specifier-gate-plant.d.ts");
try {
  writeFileSync(
    PLANT,
    "import * as t from 'styled-components/dist/types';\nexport type T = typeof t;\n",
  );
  if (unresolvedIn(PLANT).length === 0) {
    console.error(
      "✖ BLIND: a planted `styled-components/dist/types` import was reported as resolving under " +
        "nodenext. The check cannot see the failure it exists to catch, so its clean readings " +
        "mean nothing.",
    );
    process.exit(1);
  }
} finally {
  try {
    unlinkSync(PLANT);
  } catch {
    /* already gone */
  }
}

/** Rewrites one file; returns the number of specifiers changed. */
function extend(file, unplaceable) {
  const original = readFileSync(file, "utf8");
  const sourceFile = parse(file);
  const spans = [];
  for (const node of specifierNodes(sourceFile)) {
    const specifier = node.text;
    if (!isDeepSubpath(specifier)) continue;
    if (RESOLVED_EXTENSIONS.some((ext) => specifier.endsWith(ext))) continue;

    const underBundler = resolvesTo(specifier, file, "bundler");
    if (resolvesTo(specifier, file, "nodenext")) continue;

    const replacement = CANDIDATE_SUFFIXES.map(
      (suffix) => `${specifier}${suffix}`,
    ).find((candidate) => {
      const landed = resolvesTo(candidate, file, "nodenext");
      /*
       * Both halves must agree, and on the same file: a rewrite that fixes
       * nodenext by pointing bundler somewhere else is the silent
       * disagreement this is here to remove, not a fix for it.
       */
      return landed && landed === resolvesTo(candidate, file, "bundler");
    });

    if (!replacement) {
      unplaceable.push(
        `${file.slice(DIST.length)}: "${specifier}"` +
          (underBundler
            ? ` (resolves under bundler to ${underBundler})`
            : " (resolves nowhere)"),
      );
      continue;
    }
    /*
     * Reuse the quote character tsc chose rather than normalising it; a module
     * specifier is a path, so there is nothing in it to escape, and this says
     * so rather than assuming it.
     */
    const quote = original[node.getStart(sourceFile)];
    if (replacement.includes(quote) || replacement.includes("\\")) {
      unplaceable.push(
        `${file.slice(DIST.length)}: "${specifier}" cannot be requoted safely`,
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

const unplaceable = [];
let extended = 0;
for (const file of files) extended += extend(file, unplaceable);

if (unplaceable.length > 0) {
  console.error(
    `✖ ${unplaceable.length} package subpath(s) in dist/ cannot be made to resolve under ` +
      "nodenext, and this will not guess:\n" +
      `${unplaceable.map((entry) => `    ${entry}`).join("\n")}`,
  );
  process.exit(1);
}

/*
 * The count above says how many edits were made, which is not the property a
 * consumer needs. This is.
 */
const remaining = files.flatMap(unresolvedIn);
if (remaining.length > 0) {
  console.error(
    `✖ ${remaining.length} package subpath(s) in dist/ still do not resolve under nodenext, so a ` +
      "consumer on that resolver silently gets `any` for everything they name:\n" +
      `${remaining.map((entry) => `    ${entry}`).join("\n")}`,
  );
  process.exit(1);
}

console.log(
  `extend-package-specifiers: scanned ${files.length} declaration file(s), extended ${extended} ` +
    "package subpath(s); every one of them resolves under nodenext.",
);
