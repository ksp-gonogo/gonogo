import { basename, dirname, join, normalize } from "node:path";
import ts from "typescript";

/**
 * A comment that names a file the tree does not have. Two shapes, both of them
 * a promise a reader acts on without checking:
 *
 * - a test file said to pin something: the reader trusts the pin and stops
 *   looking, and the test was renamed or never written
 * - a `path/to/file.ts:NNN` citation whose file is gone
 *
 * A citation whose file still exists is NOT graded on its line: a line that
 * moved stays in range, so a range check passes the very rot it would be
 * there for. What a line number says has to be read to be judged.
 */

export interface SourceFile {
  /** Repo-relative path. */
  path: string;
  text: string;
}

export interface StaleReference {
  /** The file carrying the comment. */
  file: string;
  /** The reference as the comment spells it. */
  reference: string;
}

/** The comments in a TypeScript or JavaScript source, never its strings. */
export function commentsOf(file: SourceFile): string[] {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    file.path.endsWith("x")
      ? ts.LanguageVariant.JSX
      : ts.LanguageVariant.Standard,
    file.text,
  );
  const out: string[] = [];
  for (
    let kind = scanner.scan();
    kind !== ts.SyntaxKind.EndOfFileToken;
    kind = scanner.scan()
  ) {
    if (
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia
    )
      out.push(scanner.getTokenText());
  }
  return out;
}

const TEST_FILE =
  /(?<![\w./-])((?:[\w.@-]+\/)*[\w.-]+\.test(?:-d)?\.tsx?)(?!\w)/g;

/** A citation: a path with at least one directory segment, then `:line`. */
const CITATION =
  /(?<![\w./-])((?:[\w.@-]+\/)+[\w.-]+\.(?:tsx?|mjs|js|cs|css|json|ya?ml)):\d{1,5}/g;

/**
 * Every tracked file a reference could mean: an exact repo-relative or
 * file-relative path, or any tracked file whose path ends in the reference.
 * A bare name matches by basename anywhere, since a comment rarely spells the
 * directory of a file sitting beside it.
 */
export function referenceResolver(
  tracked: readonly string[],
): (reference: string, from: string) => boolean {
  const all = new Set(tracked);
  const bases = new Set(tracked.map((t) => basename(t)));
  return (reference, from) => {
    if (!reference.includes("/")) return bases.has(reference);
    const bare = reference.replace(/^(\.\.?\/)+/, "");
    if (all.has(normalize(reference))) return true;
    if (all.has(normalize(join(dirname(from), reference)))) return true;
    return tracked.some((t) => t.endsWith(`/${bare}`));
  };
}

export function staleReferences(
  files: readonly SourceFile[],
  resolves: (reference: string, from: string) => boolean,
): StaleReference[] {
  const out: StaleReference[] = [];
  for (const file of files) {
    for (const comment of commentsOf(file)) {
      for (const pattern of [TEST_FILE, CITATION]) {
        for (const m of comment.matchAll(pattern)) {
          if (!resolves(m[1], file.path))
            out.push({ file: file.path, reference: m[0] });
        }
      }
    }
  }
  return out;
}
