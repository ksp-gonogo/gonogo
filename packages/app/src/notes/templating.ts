/**
 * Tag templating for note bodies.
 *
 * Syntax: `{{key.path}}` is replaced with the live value of the data
 * key at render time. Resolution is local to the device — every screen
 * substitutes from its own data feed, so the value reflects whatever
 * data source the consumer reads from.
 *
 * Unknown tags render as `[?]` so the operator notices the typo without
 * the substitution silently swallowing the rest of the note.
 *
 * Tags must be `[a-zA-Z0-9._\[\]-]+` — covers Telemachus key shapes
 * including bracketed resource keys like `r.resource[Oxidizer]`.
 */

const TAG_RE = /\{\{\s*([a-zA-Z0-9._[\]-]+)\s*\}\}/g;

export interface TemplatingResolver {
  (key: string): unknown;
}

export function extractTags(body: string): string[] {
  const out: string[] = [];
  for (const match of body.matchAll(TAG_RE)) {
    if (!out.includes(match[1])) out.push(match[1]);
  }
  return out;
}

export function renderTemplate(
  body: string,
  resolve: TemplatingResolver,
): string {
  return body.replace(TAG_RE, (_, key: string) => {
    const value = resolve(key);
    return formatValue(value);
  });
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "[?]";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "[?]";
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2);
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value;
  // Objects / arrays — best-effort. Big payloads are usable enough as
  // JSON for debug overlays; the operator can craft a more specific tag
  // if they want a single field.
  try {
    return JSON.stringify(value);
  } catch {
    return "[?]";
  }
}
