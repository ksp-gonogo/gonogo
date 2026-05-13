/**
 * Tag templating for note bodies.
 *
 * Syntax: `{{key.path}}` is replaced with the live value of the data
 * key at render time. Resolution is local to the device — every screen
 * substitutes from its own data feed, so the value reflects whatever
 * data source the consumer reads from.
 *
 * Rendering distinguishes three failure modes so the operator can tell
 * a typo from a slow-to-arrive value:
 *   - Key isn't in the data source schema  → `[?<key>]`
 *   - Key is known but value not arrived yet → `…`
 *   - Value is null/NaN                     → `—`
 *
 * Tags must be `[a-zA-Z0-9._\[\]-]+` — covers Telemachus key shapes
 * including bracketed resource keys like `r.resource[Oxidizer]`.
 */

const TAG_RE = /\{\{\s*([a-zA-Z0-9._[\]-]+)\s*\}\}/g;

export type TemplatingResolver = (key: string) => unknown;

export interface RenderOptions {
  /** Set of keys present in the data source schema. Used to distinguish
   *  "unknown key" from "value not yet arrived". When omitted, every key
   *  is treated as known (legacy behaviour). */
  knownKeys?: ReadonlySet<string>;
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
  options: RenderOptions = {},
): string {
  const { knownKeys } = options;
  return body.replace(TAG_RE, (_, key: string) => {
    const value = resolve(key);
    if (value === undefined && knownKeys && !knownKeys.has(key)) {
      // Surface the actual key so the operator can tell whether it's a
      // typo (`kc.reputation` vs `career.reputation`) or a key that was
      // valid in an earlier session and got renamed.
      return `[?${key}]`;
    }
    return formatValue(value);
  });
}

function formatValue(value: unknown): string {
  if (value === undefined) return "…";
  if (value === null) return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
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
    return "—";
  }
}
