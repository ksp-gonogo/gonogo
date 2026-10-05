/**
 * Prose as review-sheet items: reading a copy table out of its module, the
 * fingerprint of one string, which story shows it, and writing edited strings
 * back.
 *
 * A string may carry `{name}` and `{name?one|other}` marks its caller fills
 * and `[words](target)` links. An edit may drop one of those and may not add
 * one, since the code fills and resolves only the ones the string already had.
 */
import { createHash } from "node:crypto";
import { ts } from "ts-morph";

export interface CopyEntry {
  key: string;
  text: string;
  /** Where the string's literal sits in the module's text, quotes included. */
  start: number;
  end: number;
}

function unwrap(node: ts.Expression): ts.Expression {
  let at = node;
  while (
    ts.isAsExpression(at) ||
    ts.isSatisfiesExpression(at) ||
    ts.isParenthesizedExpression(at)
  ) {
    at = at.expression;
  }
  return at;
}

/**
 * Every string of the table `exportName` in a module's text, in the order
 * written. Throws when the table is missing or holds anything but plain
 * string literals under literal keys, since those are what can be rewritten.
 */
export function readCopy(
  moduleText: string,
  exportName: string,
  file = "copy.ts",
): CopyEntry[] {
  const source = ts.createSourceFile(
    file,
    moduleText,
    ts.ScriptTarget.Latest,
    true,
  );
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== exportName)
        continue;
      const table = decl.initializer && unwrap(decl.initializer);
      if (!table || !ts.isObjectLiteralExpression(table)) {
        throw new Error(`${file}: ${exportName} is not an object literal`);
      }
      return table.properties.map((prop) => {
        const where = `${file}: ${exportName}`;
        if (
          !ts.isPropertyAssignment(prop) ||
          !(ts.isStringLiteral(prop.name) || ts.isIdentifier(prop.name))
        ) {
          throw new Error(`${where} holds an entry that is not key: "string"`);
        }
        const key = prop.name.text;
        const value = prop.initializer;
        if (
          !ts.isStringLiteral(value) &&
          !ts.isNoSubstitutionTemplateLiteral(value)
        ) {
          throw new Error(`${where} ${key} is not a plain string literal`);
        }
        return {
          key,
          text: value.text,
          start: value.getStart(source),
          end: value.getEnd(),
        };
      });
    }
  }
  throw new Error(`${file} declares no ${exportName}`);
}

/** A prose item's fingerprint: its text and nothing else. */
export function proseFingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

const MARK = /\{(\w+)(?:\?([^|}]*)\|([^}]*))?\}/g;
const LINK = /\[([^\]]+)\]\((\w+)\)/g;

/** The value names a string asks its caller for. */
export function markNames(text: string): string[] {
  return [...new Set([...text.matchAll(MARK)].map((m) => m[1]))];
}

/** The link targets a string names. */
export function linkTargets(text: string): string[] {
  return [...new Set([...text.matchAll(LINK)].map((m) => m[2]))];
}

function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A pattern for a string as a page shows it: a value as any run of text, a
 * plural as either of its forms, a link as its words. Unanchored.
 */
export function shownPattern(text: string): string {
  const marks = /\{(\w+)(?:\?([^|}]*)\|([^}]*))?\}|\[([^\]]+)\]\(\w+\)/g;
  let out = "";
  let at = 0;
  for (const m of text.matchAll(marks)) {
    out += literal(text.slice(at, m.index)) + markPattern(m);
    at = m.index + m[0].length;
  }
  return out + literal(text.slice(at));
}

/** One mark as a page shows it: a link's words, either form of a plural, or any text for a value. */
function markPattern(m: RegExpMatchArray): string {
  if (m[4] !== undefined) return literal(m[4]);
  if (m[2] !== undefined) return `(?:${literal(m[2])}|${literal(m[3])})`;
  return ".+";
}

/**
 * What each story's page reads, by story id: the text of every element on it
 * and every worded attribute, whitespace collapsed.
 */
export type Shown = Record<string, readonly string[]>;

/**
 * The stories that best show one string, in the order given. A story where
 * the string is the whole of some element beats one where it is only part of
 * a longer run, and before either, a story named for the key's own first
 * segment (`uplinks.heading` in an `uplinks-...` story) beats one that is not:
 * a heading is repeated inside other steps' sentences, and its own step is
 * where it is read as a heading. Only the best-placed stories are returned.
 */
export function storiesShowing(
  key: string,
  text: string,
  shown: Shown,
  order: readonly string[],
): string[] {
  const pattern = shownPattern(text);
  const whole = new RegExp(`^${pattern}$`);
  const part = new RegExp(pattern);
  const segment = key.split(".")[0].toLowerCase();
  let best = Number.POSITIVE_INFINITY;
  const ranked: { id: string; rank: number }[] = [];
  for (const id of order) {
    const texts = shown[id] ?? [];
    const isWhole = texts.some((t) => whole.test(t));
    if (!isWhole && !texts.some((t) => part.test(t))) continue;
    const named = id.slice(id.indexOf("--") + 2).includes(segment);
    const rank = (named ? 0 : 2) + (isWhole ? 0 : 1);
    ranked.push({ id, rank });
    best = Math.min(best, rank);
  }
  return ranked.filter((r) => r.rank === best).map((r) => r.id);
}

/** One edited string, as the sheet's export carries it. */
export interface ProseEdit {
  /** The item id: source id, a colon, the key. */
  id: string;
  old: string;
  new: string;
}

export interface Refusal {
  id: string;
  why: string;
}

export interface Applied {
  /** The module's text with every accepted edit written in. */
  text: string;
  applied: ProseEdit[];
  /** Edits whose new text the table already holds. */
  already: ProseEdit[];
  refused: Refusal[];
}

function added(before: string[], after: string[]): string[] {
  return after.filter((name) => !before.includes(name));
}

/** Why an edit cannot be written over `current`, or nothing when it can. */
function refusal(edit: ProseEdit, current: string): string | undefined {
  if (current !== edit.old) {
    return `the text has changed since the export: it now reads ${JSON.stringify(current)}`;
  }
  if (edit.new.trim() === "") return "the new text is empty";
  if (/[\r\n]/.test(edit.new)) return "the new text has a line break";
  const marks = added(markNames(edit.old), markNames(edit.new));
  if (marks.length > 0) {
    return `the new text asks for {${marks.join("}, {")}}, which nothing fills`;
  }
  const links = added(linkTargets(edit.old), linkTargets(edit.new));
  if (links.length > 0) {
    return `the new text links to (${links.join("), (")}), which the old text did not`;
  }
  return undefined;
}

/**
 * Writes one source's edits into its module's text. An edit is refused, and
 * the rest still written, when its key is gone, when the table no longer
 * holds the text the edit was made against, or when the new text adds a mark.
 */
export function applyEdits(
  moduleText: string,
  exportName: string,
  sourceId: string,
  edits: readonly ProseEdit[],
): Applied {
  const entries = new Map(
    readCopy(moduleText, exportName).map((entry) => [entry.key, entry]),
  );
  const out: Applied = {
    text: moduleText,
    applied: [],
    already: [],
    refused: [],
  };
  const writes: { entry: CopyEntry; text: string }[] = [];
  const seen = new Set<string>();
  for (const edit of edits) {
    const key = edit.id.slice(sourceId.length + 1);
    const entry = entries.get(key);
    if (!entry) {
      out.refused.push({ id: edit.id, why: `${exportName} has no key ${key}` });
      continue;
    }
    if (seen.has(key)) {
      out.refused.push({ id: edit.id, why: "the export edits this key twice" });
      continue;
    }
    seen.add(key);
    if (entry.text === edit.new) {
      out.already.push(edit);
      continue;
    }
    const why = refusal(edit, entry.text);
    if (why) {
      out.refused.push({ id: edit.id, why });
      continue;
    }
    writes.push({ entry, text: edit.new });
    out.applied.push(edit);
  }
  for (const { entry, text } of writes.sort(
    (a, b) => b.entry.start - a.entry.start,
  )) {
    out.text =
      out.text.slice(0, entry.start) +
      JSON.stringify(text) +
      out.text.slice(entry.end);
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The edited strings a review-sheet export carries, refusing one of any other shape. */
export function readEdits(raw: unknown, file: string): ProseEdit[] {
  if (!isRecord(raw) || !Array.isArray(raw.items)) {
    throw new Error(`${file} is not a review-sheet export`);
  }
  const prose = raw.prose ?? [];
  if (!Array.isArray(prose)) throw new Error(`${file} prose is not a list`);
  return prose.map((edit, i): ProseEdit => {
    if (
      !isRecord(edit) ||
      typeof edit.id !== "string" ||
      typeof edit.old !== "string" ||
      typeof edit.new !== "string"
    ) {
      throw new Error(`${file} prose ${i} is not { id, old, new }`);
    }
    return { id: edit.id, old: edit.old, new: edit.new };
  });
}
