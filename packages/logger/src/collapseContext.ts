import type { LogEntry } from "./types.js";

/** Objects nested deeper than this below `context` are sent as a JSON string. */
export const MAX_CONTEXT_DEPTH = 3;

/** An object with more keys than this is sent as a JSON string. */
export const MAX_CONTEXT_KEYS = 12;

/**
 * The context keys that stay real fields of the dataset: the ones queries
 * filter on. Every other key travels inside the single `extra` field as a JSON
 * string, so a new one-off key cannot add a field.
 */
export const ALLOWED_CONTEXT_KEYS: ReadonlySet<string> = new Set([
  "id",
  "reason",
  "error",
  "topic",
  "code",
  "peerId",
  "status",
  "command",
  "type",
  "outcome",
  "name",
  "key",
  "kind",
  "source",
  "state",
  "action",
  "count",
  "durationMs",
  "host",
  "role",
  "widget",
  "requestId",
  "userId",
  "service",
  "bug_report",
]);

/** The field that holds every context key outside {@link ALLOWED_CONTEXT_KEYS}. */
export const EXTRA_CONTEXT_KEY = "extra";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function collapse(value: unknown, depth: number): unknown {
  if (!isPlainObject(value)) return value;
  const keys = Object.keys(value);
  if (depth > MAX_CONTEXT_DEPTH || keys.length > MAX_CONTEXT_KEYS) {
    return JSON.stringify(value);
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = collapse(value[key], depth + 1);
  return out;
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "[unserialisable]";
  }
}

/**
 * A copy of `entry` whose context cannot grow the dataset's field list with
 * its data. Axiom turns every key path of an event into a field, and a dataset
 * holds a fixed number of them. Context keys outside the allowlist are sent
 * together as one JSON string in `extra`. An allowed key whose object has too
 * many keys, or is nested too deep, is also sent as a JSON string, so an object
 * keyed by Topic, channel or peer names adds no fields; an array is one field
 * however long it is.
 */
export function collapseContext(entry: LogEntry): LogEntry {
  if (!entry.context) return entry;
  const context: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry.context)) {
    if (ALLOWED_CONTEXT_KEYS.has(key)) context[key] = collapse(value, 1);
    else extra[key] = value;
  }
  if (Object.keys(extra).length > 0) {
    context[EXTRA_CONTEXT_KEY] = stringify(extra);
  }
  return { ...entry, context };
}
