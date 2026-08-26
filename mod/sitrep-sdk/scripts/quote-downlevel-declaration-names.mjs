/**
 * Quotes property names in the emitted declarations that only lex as
 * identifiers above a certain language version.
 *
 * `tsc` decides whether to quote a property name using the identifier tables of
 * the target it is COMPILING at, then writes the answer into a `.d.ts` that is
 * READ at whatever target the consumer picked. For a type written out in source
 * the original quoting survives, but the type of an object literal is
 * synthesised from the symbol table and the name is regenerated, so the source
 * cannot influence it.
 *
 * The unit table is where that bites. `N·m` holds U+00B7, which is an
 * identifier character from ES2015 on and not before, so this package building
 * at ES2022 emits it bare and a consumer compiling at ES5 cannot parse the
 * declaration file at all: measured at 223 errors out of one property, because
 * the parse desynchronises and every declaration after it fails too.
 *
 * Rewriting to a quoted name is what `tsc` itself emits when it targets ES5,
 * and it is accepted identically at every version, so the output stops
 * depending on the consumer's target. Validity is decided by TypeScript's own
 * `isIdentifierText` rather than a pattern of our own, so this agrees with the
 * compiler by construction instead of by resemblance.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/** The oldest target the published declarations are expected to parse under. */
const FLOOR_TARGET = ts.ScriptTarget.ES5;

/**
 * Declarations are emitted per source module, so this many files is a build
 * that ran. Zero, or a handful, means `dist` is stale or absent and every
 * "nothing to quote" below would be this script failing to look rather than
 * finding nothing.
 */
const MIN_DECLARATION_FILES = 100;

const DIST = new URL("../dist/", import.meta.url).pathname;

function declarationFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...declarationFiles(path));
    else if (entry.name.endsWith(".d.ts")) found.push(path);
  }
  return found;
}

/** Escapes to `\uXXXX` so the result is pure ASCII, as tsc's own ES5 emit is. */
function quoted(name) {
  const escaped = [...name]
    .map((char) => {
      const code = char.codePointAt(0);
      if (char === '"' || char === "\\") return `\\${char}`;
      if (code < 0x20 || code > 0x7e)
        return `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
      return char;
    })
    .join("");
  return `"${escaped}"`;
}

let files;
try {
  files = declarationFiles(DIST);
} catch (cause) {
  console.error(
    `✖ ${DIST} could not be read, so there are no declarations to check. Run the tsc build first.`,
  );
  throw cause;
}

if (files.length < MIN_DECLARATION_FILES) {
  console.error(
    `✖ BLIND: found only ${files.length} declaration file(s) under dist/, expected at least ` +
      `${MIN_DECLARATION_FILES}. A pass over an empty tree reports the same "nothing to quote" as a ` +
      "clean one, so this refuses to report success.",
  );
  process.exit(1);
}

/**
 * Collects the spans of every property name emitted bare that the floor target
 * does not accept as an identifier. Edits are applied back to front so an
 * earlier rewrite cannot move a later span.
 */
function rewrites(sourceFile) {
  const spans = [];
  const visit = (node) => {
    const name =
      ts.isPropertySignature(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isMethodSignature(node) ||
      ts.isPropertyAssignment(node) ||
      ts.isEnumMember(node)
        ? node.name
        : undefined;
    if (
      name &&
      ts.isIdentifier(name) &&
      !ts.isIdentifierText(name.text, FLOOR_TARGET)
    ) {
      spans.push({
        start: name.getStart(sourceFile),
        end: name.getEnd(),
        text: quoted(name.text),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return spans;
}

let quotedCount = 0;
const touched = [];
for (const file of files) {
  const original = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    original,
    ts.ScriptTarget.Latest,
    true,
  );
  const spans = rewrites(sourceFile);
  if (spans.length === 0) continue;
  let updated = original;
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    updated =
      updated.slice(0, span.start) + span.text + updated.slice(span.end);
  }
  writeFileSync(file, updated);
  quotedCount += spans.length;
  touched.push(`${file.slice(DIST.length)} (${spans.length})`);
}

console.log(
  `quote-downlevel-declaration-names: scanned ${files.length} declaration file(s), quoted ` +
    `${quotedCount} name(s) that do not lex as identifiers at ${ts.ScriptTarget[FLOOR_TARGET]}` +
    (touched.length > 0 ? `: ${touched.join(", ")}` : ""),
);
