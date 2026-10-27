import type { LogEntry } from "./types.js";

/** Objects nested deeper than this below `context` are sent as a JSON string. */
export const MAX_CONTEXT_DEPTH = 3;

/** An object with more keys than this is sent as a JSON string. */
export const MAX_CONTEXT_KEYS = 12;

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

/**
 * A copy of `entry` whose context cannot grow the dataset's field list with
 * its data. Axiom turns every key path of an event into a field, and a dataset
 * holds a fixed number of them, so an object keyed by Topic, channel or peer
 * names adds fields without end. Such an object (too many keys, or nested too
 * deep) is sent as one JSON string; an array is one field however long it is.
 */
export function collapseContext(entry: LogEntry): LogEntry {
  if (!entry.context) return entry;
  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry.context)) {
    context[key] = collapse(value, 1);
  }
  return { ...entry, context };
}
