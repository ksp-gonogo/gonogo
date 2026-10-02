import ts from "typescript";
import { commentsOf, type SourceFile } from "./stale-references.scan";

/**
 * A comment that names a symbol in code format which no source file declares or
 * uses. The reader of `foo` trusts that it is a thing they can search for, so a
 * renamed or never-written name sends them hunting.
 *
 * Only a camelCase or PascalCase identifier of four characters or more is
 * graded: shorter or lower-case words are as often prose, a CSS property or a
 * prop value as a symbol. A name counts as present when any code token in any
 * scanned source, a string included, spells it, so the scan under-reports by
 * design rather than guessing which package a name was meant to live in.
 */

const SYMBOL = /`([A-Za-z_$][\w$]*)(?:\(\))?`/g;
const HUMP = /[a-z][A-Z]|^[A-Z][a-z]/;
const WORD = /[A-Za-z_$][\w$]*/g;

export interface DeadIdentifier {
  /** The file carrying the comment. */
  file: string;
  symbol: string;
}

/** Every word a code token spells, comments excluded. A C# source is read as words throughout. */
export function codeWords(file: SourceFile): Set<string> {
  const words = new Set<string>();
  if (file.path.endsWith(".cs")) {
    for (const m of file.text.matchAll(WORD)) words.add(m[0]);
    return words;
  }
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    file.path.endsWith("x")
      ? ts.LanguageVariant.JSX
      : ts.LanguageVariant.Standard,
    file.text,
  );
  for (
    let kind = scanner.scan();
    kind !== ts.SyntaxKind.EndOfFileToken;
    kind = scanner.scan()
  ) {
    if (
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia
    )
      continue;
    for (const m of scanner.getTokenText().matchAll(WORD)) words.add(m[0]);
  }
  return words;
}

/**
 * `exists` is the union of `codeWords` over the whole tree, `graded` the files
 * whose comments are held to it, and `external` the names that belong to a
 * platform or a dependency the tree only calls.
 */
export function deadIdentifiers(
  graded: readonly SourceFile[],
  exists: ReadonlySet<string>,
  external: ReadonlySet<string>,
): DeadIdentifier[] {
  const out: DeadIdentifier[] = [];
  for (const file of graded) {
    const seen = new Set<string>();
    for (const comment of commentsOf(file)) {
      for (const m of comment.matchAll(SYMBOL)) {
        const symbol = m[1];
        if (symbol.length < 4 || !HUMP.test(symbol)) continue;
        if (exists.has(symbol) || external.has(symbol) || seen.has(symbol))
          continue;
        seen.add(symbol);
        out.push({ file: file.path, symbol });
      }
    }
  }
  return out;
}
