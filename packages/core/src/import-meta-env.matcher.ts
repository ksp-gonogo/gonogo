/**
 * Detects a non-literal read of `import.meta.env`.
 *
 * Vite substitutes environment variables only where the source spells the
 * literal text `import.meta.env`, including through a type cast that TypeScript
 * erases before the bundler ever sees it (`(import.meta as X).env` compiles to
 * `import.meta.env`). A read built any other way, through `Reflect.get`, bracket
 * indexing, or destructuring, never gets substituted: it reads `undefined` in
 * both the dev server and the bundle, silently, because `import.meta` itself is
 * a real object at runtime and none of those forms throws.
 *
 * That is exactly what the unknown-cast ratchet's cleanup produced: rewriting
 * `(import.meta as ImportMeta & { env?: ... }).env` into `Reflect.get(import.meta,
 * "env")` to get the assertion off the unknown-cast debt list silently broke
 * three env reads (`VITE_PEER_*`, `VITE_SITREP_HOST` twice), fixed by spelling
 * the cast back out. This scan is the guard against that trade happening again:
 * a cast that reaches `.env` is fine, anything that reaches it through a
 * runtime property lookup is not.
 *
 * Comments and string/template contents are stripped before matching, so a
 * doc comment that quotes the banned form (as the three fixed sites now do, to
 * say why they spell it out) is not itself a violation.
 */

export interface ImportMetaEnvViolation {
  /** 1-based line number in the original source. */
  line: number;
  /** The offending text, trimmed for display. */
  text: string;
  /** Which forbidden spelling matched. */
  kind: "reflect-get" | "bracket" | "destructure";
}

const PATTERNS: Array<{
  kind: ImportMetaEnvViolation["kind"];
  re: RegExp;
}> = [
  // Reflect.get(import.meta, ...): a runtime property lookup, invisible to
  // Vite's static substitution regardless of which key is read.
  { kind: "reflect-get", re: /Reflect\.get\(\s*import\.meta\b/g },
  // import.meta["env"] / import.meta['env'] / import.meta[`env`]: the same
  // property, reached by a computed member instead of the dotted literal.
  { kind: "bracket", re: /import\.meta\s*\[\s*(["'`])env\1\s*\]/g },
  // const { env } = import.meta (or a rename, `{ env: alias }`): the
  // destructure reads the property off import.meta before Vite gets a chance
  // to see the dotted access it substitutes.
  {
    kind: "destructure",
    re: /\{[^}]*\benv\b[^}]*\}\s*=\s*import\.meta\b/g,
  },
];

/**
 * Blanks out comments and string/template literal contents, preserving line
 * breaks so reported line numbers still line up with the original source.
 *
 * Not a full tokenizer: it does not need to be. It only has to stop a
 * backtick-quoted mention of the banned form inside a comment, or a planted
 * example inside a test fixture string, from reading as the real thing, and a
 * quote-aware, comment-aware single pass over the byte stream does that.
 *
 * One string is kept rather than blanked: one immediately after a `[`, since
 * that is a computed member access, and `import.meta["env"]` IS the code this
 * scan exists to catch, not prose about it. Stripping it along with every
 * other string would make the bracket spelling undetectable anywhere, not
 * just inside this file.
 */
function withoutCommentsAndStrings(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const nl = source.indexOf("\n", i);
      i = nl === -1 ? n : nl;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let j = i; j < stop; j++) if (source[j] === "\n") out += "\n";
      i = stop;
      continue;
    }
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const isBracketKey = out.trimEnd().endsWith("[");
      if (isBracketKey) out += c;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") {
          if (isBracketKey) out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (isBracketKey) out += source[i];
        else if (source[i] === "\n") out += "\n";
        i++;
      }
      if (isBracketKey) out += quote;
      i++; // the closing quote, if the string was well-formed
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Every forbidden spelling found in one file's source. */
export function findImportMetaEnvViolations(
  source: string,
): ImportMetaEnvViolation[] {
  const code = withoutCommentsAndStrings(source);
  const violations: ImportMetaEnvViolation[] = [];
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    for (let match = re.exec(code); match !== null; match = re.exec(code)) {
      const line = code.slice(0, match.index).split("\n").length;
      violations.push({
        line,
        text: match[0].replace(/\s+/g, " ").trim(),
        kind,
      });
      if (match[0].length === 0) re.lastIndex++;
    }
  }
  violations.sort((a, b) => a.line - b.line);
  return violations;
}

/** Extensions this scan owns: TS/TSX/JS, source and test files alike. */
export const IMPORT_META_ENV_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

export function hasScannedExtension(file: string): boolean {
  return IMPORT_META_ENV_EXTENSIONS.some((ext) => file.endsWith(ext));
}
