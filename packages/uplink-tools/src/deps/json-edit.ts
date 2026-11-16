import { isDeepStrictEqual } from "node:util";

interface Span {
  start: number;
  end: number;
}

/** The index just past the string literal that opens at `from`. */
function stringEnd(text: string, from: number): number {
  let i = from + 1;
  while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
  return i + 1;
}

/** The index just past the value that starts at `from`, whatever it is. */
function valueEnd(text: string, from: number): number {
  if (text[from] === '"') return stringEnd(text, from);
  if (text[from] !== "{" && text[from] !== "[") {
    let i = from;
    while (i < text.length && !/[,}\]\s]/.test(text[i] as string)) i++;
    return i;
  }
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      i = stringEnd(text, i) - 1;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

interface Property {
  key: string;
  /** From the key's opening quote to the end of its value. */
  span: Span;
  value: Span;
}

/** The properties of the object that opens at `open`, in order. */
function properties(text: string, open: number): Property[] {
  const found: Property[] = [];
  let i = open + 1;
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i] as string)) i++;
    if (text[i] !== '"') break;
    const keyEnd = stringEnd(text, i);
    const key: unknown = JSON.parse(text.slice(i, keyEnd));
    if (typeof key !== "string") break;
    let at = keyEnd;
    while (text[at] !== ":") at++;
    at++;
    while (/\s/.test(text[at] as string)) at++;
    const end = valueEnd(text, at);
    found.push({ key, span: { start: i, end }, value: { start: at, end } });
    i = end;
  }
  return found;
}

/**
 * Sets, adds or removes string properties of the top-level `mod` object by
 * editing only those lines of `text`, so every other byte (inline arrays
 * included) stays as written. A property that is not there is added after
 * `builtAgainst`. Undefined when `text` has no such `mod` object to edit.
 */
function editModStrings(
  text: string,
  changes: Record<string, string | undefined>,
): string | undefined {
  const root = text.indexOf("{");
  if (root < 0) return undefined;
  const mod = properties(text, root).find((p) => p.key === "mod");
  if (!mod || text[mod.value.start] !== "{") return undefined;
  let out = text;
  for (const [key, value] of Object.entries(changes)) {
    const current = properties(out, root).find((p) => p.key === "mod");
    if (!current) return undefined;
    const props = properties(out, current.value.start);
    const existing = props.find((p) => p.key === key);
    if (existing && value !== undefined) {
      out = `${out.slice(0, existing.value.start)}${JSON.stringify(value)}${out.slice(existing.value.end)}`;
      continue;
    }
    if (existing) {
      const next = props[props.indexOf(existing) + 1];
      if (!next) return undefined;
      const lineStart = out.lastIndexOf("\n", existing.span.start) + 1;
      const nextLine = out.lastIndexOf("\n", next.span.start) + 1;
      if (nextLine <= existing.span.start) return undefined;
      out = out.slice(0, lineStart) + out.slice(nextLine);
      continue;
    }
    if (value === undefined) continue;
    const anchor = props.find((p) => p.key === "builtAgainst");
    if (!anchor || anchor === props[props.length - 1]) return undefined;
    const lineStart = out.lastIndexOf("\n", anchor.span.start) + 1;
    const indent = out.slice(lineStart, anchor.span.start);
    if (indent.trim() !== "") return undefined;
    const after = anchor.span.end;
    out = `${out.slice(0, after)},\n${indent}${JSON.stringify(key)}: ${JSON.stringify(value)}${out.slice(after)}`;
  }
  return out;
}

/**
 * The text of `original` with only the named `mod` string properties changed,
 * when that gives exactly `expected` once parsed, and undefined otherwise so a
 * caller can fall back to writing the whole object.
 */
export function patchModStrings(
  original: string,
  changes: Record<string, string | undefined>,
  expected: unknown,
): string | undefined {
  try {
    const patched = editModStrings(original, changes);
    if (patched === undefined) return undefined;
    return isDeepStrictEqual(JSON.parse(patched), expected)
      ? patched
      : undefined;
  } catch {
    return undefined;
  }
}
