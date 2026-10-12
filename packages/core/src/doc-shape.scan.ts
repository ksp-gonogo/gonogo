import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { docBlocks, sourceFiles } from "./doc-emphasis.scan";

/**
 * The scan behind `styleguide-doc-shape.test.ts`: two ways a doc comment turns
 * into something other than what its author wrote.
 *
 * - A markdown table whose rows no longer line up. TSDoc and the reference site
 *   render a table only when a header row is followed by a separator row and
 *   every row has the same number of cells; anything else prints as pipes.
 * - A file-header block directly above an export. A `/** *\/` block that opens
 *   the file and touches the first declaration is that declaration's doc, so
 *   the file's overview prints as the hover text of one export.
 * - An HTML tag or C# doc tag in a TypeScript doc comment. TSDoc has no
 *   `<p>`, `<b>` or `<see cref>`, so the hover text prints them literally.
 */

const SOURCE_RE = /\.(ts|tsx|mts)$/;

/** Hand-written source of a published package, where a doc comment is hover text for an Uplink author. */
export const PUBLISHED_SOURCE_RE =
  /^(?:mod\/sitrep-sdk|packages\/ui-kit|packages\/uplink-tools)\/src\/(?!.*\.(?:test|test-d)\.tsx?$)/;

const GENERATED_PATH_RE =
  /(?:\.d\.ts$|\/(?:generated|__generated__|dist|vendor|node_modules|obj|bin)\/)/;

export interface ShapeHit {
  line: number;
  text: string;
  reason: string;
}

/** The comment body with the comment markers removed, one entry per source line. */
function bodyLines(
  body: string,
  csharp: boolean,
): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  let offset = 0;
  for (const raw of body.split("\n")) {
    const text = csharp
      ? raw.replace(/^\s*\/\/\/ ?/, "")
      : raw.replace(/^\s*(?:\/\*\*|\*\/|\*)\s?/, "").replace(/\*\/\s*$/, "");
    out.push({ text, offset });
    offset += raw.length + 1;
  }
  return out;
}

/** Cells of a table row, ignoring pipes that are escaped or inside a code span. */
function cellCount(row: string): number {
  const stripped = row
    .trim()
    .replace(/`[^`]*`/g, "x")
    .replace(/\\\|/g, "x");
  const inner = stripped.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").length;
}

const SEPARATOR_RE = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/;

/** Mangled tables in one file's doc comments. */
export function mangledTablesIn(source: string, csharp: boolean): ShapeHit[] {
  const hits: ShapeHit[] = [];
  const lineOf = (offset: number): number =>
    source.slice(0, offset).split("\n").length;
  for (const block of docBlocks(source, csharp)) {
    const lines = bodyLines(block.body, csharp);
    let inFence = false;
    let i = 0;
    while (i < lines.length) {
      const text = lines[i].text;
      if (/^\s*```/.test(text)) inFence = !inFence;
      if (inFence || !/^\s*\|/.test(text)) {
        if (!inFence && /\|\s*:?-{3,}:?\s*\|/.test(text)) {
          hits.push({
            line: lineOf(block.start + lines[i].offset),
            text: text.trim().slice(0, 90),
            reason: "a separator row sits inside a line of prose",
          });
        }
        i++;
        continue;
      }
      let end = i;
      while (end < lines.length && /^\s*\|/.test(lines[end].text)) end++;
      const rows = lines.slice(i, end).map((l) => l.text.trim());
      const at = lineOf(block.start + lines[i].offset);
      const fail = (reason: string) =>
        hits.push({ line: at, text: rows[0].slice(0, 90), reason });
      if (rows.length < 2 || !SEPARATOR_RE.test(rows[1])) {
        fail("the row after the header is not a separator row");
      } else {
        const width = cellCount(rows[0]);
        const odd = rows.findIndex((r) => cellCount(r) !== width);
        if (odd !== -1) {
          fail(
            `row ${odd + 1} has ${cellCount(rows[odd])} cells, the header ${width}`,
          );
        }
      }
      i = end;
    }
  }
  return hits;
}

const MARKUP_MASKS: RegExp[] = [
  /```[\s\S]*?```/g,
  /`[^`\n]*`/g,
  /@example[\s\S]*?(?=\n\s*\*?\s*@[a-z]|\*\/|$)/g,
  /\{@[^}]*\}/g,
];

const MARKUP_RE =
  /<\/?(?:p|b|i|c|em|strong|br|ul|ol|li|para|see|seealso|code|paramref|typeparamref|summary|remarks|list|item|description)(?:\s[^>\n]*)?\/?>/g;

/** A C# or HTML doc tag in the prose of a TypeScript doc comment. */
export function markupInTsDocIn(source: string): ShapeHit[] {
  const hits: ShapeHit[] = [];
  for (const block of docBlocks(source, false)) {
    const chars = [...block.body];
    for (const re of MARKUP_MASKS) {
      for (const m of block.body.matchAll(re)) {
        const from = m.index ?? 0;
        for (let i = from; i < from + m[0].length; i++) {
          if (chars[i] !== "\n") chars[i] = " ";
        }
      }
    }
    for (const m of chars.join("").matchAll(MARKUP_RE)) {
      const offset = block.start + (m.index ?? 0);
      hits.push({
        line: source.slice(0, offset).split("\n").length,
        text: m[0],
        reason:
          "a tag TSDoc does not render prints literally in the hover text",
      });
    }
  }
  return hits;
}

const EXPORT_RE = /^export\s/;
const FILE_WORDS_RE = /\bthis (?:file|module|barrel|entry point)\b/i;

/**
 * A file-header doc block that touches the first export below it and speaks of
 * the file. Above a re-export the block attaches to nothing, so only a
 * declaration is at risk of taking it as its own doc.
 */
export function headerBlockAboveExportIn(source: string): ShapeHit[] {
  const head =
    /^(?:[ \t]*(?:#!.*|\/\/[^\n]*|"use [a-z ]+";?)\n)*[ \t]*(\/\*\*(?!\/)[\s\S]*?\*\/)[ \t]*\n([^\n]*)/.exec(
      source,
    );
  if (!head) return [];
  const block = head[1];
  const next = head[2];
  if (!EXPORT_RE.test(next)) return [];
  if (/^export\s+(?:type\s+)?[*{]/.test(next)) return [];
  if (!FILE_WORDS_RE.test(block)) return [];
  return [
    {
      line: source.slice(0, source.indexOf(block)).split("\n").length,
      text: next.trim().slice(0, 90),
      reason:
        "a doc block that describes the file sits directly above an export",
    },
  ];
}

export interface ShapeScan {
  enumerated: number;
  scanned: number;
  tables: Map<string, ShapeHit[]>;
  headers: Map<string, ShapeHit[]>;
  markup: Map<string, ShapeHit[]>;
}

export function scanDocShape(
  covers: (rel: string) => boolean = () => true,
): ShapeScan {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  const listed = sourceFiles(root).filter((f) => /\.(ts|tsx|mts|cs)$/.test(f));
  const tables = new Map<string, ShapeHit[]>();
  const headers = new Map<string, ShapeHit[]>();
  const markup = new Map<string, ShapeHit[]>();
  let scanned = 0;
  for (const file of listed) {
    if (GENERATED_PATH_RE.test(`/${file}`) || !covers(file)) continue;
    let source: string;
    try {
      source = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    if (/<auto-?generated|@generated/i.test(source.slice(0, 400))) continue;
    scanned++;
    const found = mangledTablesIn(source, file.endsWith(".cs"));
    if (found.length > 0) tables.set(file, found);
    if (SOURCE_RE.test(file) && PUBLISHED_SOURCE_RE.test(file)) {
      const h = headerBlockAboveExportIn(source);
      if (h.length > 0) headers.set(file, h);
      const m = markupInTsDocIn(source);
      if (m.length > 0) markup.set(file, m);
    }
  }
  return { enumerated: listed.length, scanned, tables, headers, markup };
}
